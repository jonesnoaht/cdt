/**
 * `npm run lifecycle` — run the full CD lifecycle on the Cardano preview
 * testnet, printing every tx hash and writing the evidence report
 * (TESTNET-RUN.md) when the run completes:
 *
 *  CD 1 (redeem at maturity):
 *    1. issuer mints a CDT (oracle co-signs) and locks principal + full
 *       interest at the vault; the CDT goes to the member;
 *    2. wait until the CD matures (~12 minutes; preview slot = 1 s);
 *    3. the member redeems: burns the CDT, receives principal + full interest.
 *
 *  CD 2 (early withdrawal with penalty):
 *    4. issuer mints a second CDT with a 1-year maturity;
 *    5. after ~2 minutes the member withdraws early: burns the CDT, receives
 *       principal + accrued − penalty; the remainder returns to the issuer.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  Data,
  fromText,
  toUnit,
  type LucidEvolution,
  type UTxO,
} from "@lucid-evolution/lucid";
import {
  CDDatum,
  MintRedeemer,
  buildEarlyWithdrawTx,
  buildRedeemTx,
  fullInterest,
  resolveCdtScripts,
  type Blueprint,
  type CDTerms,
  type CdtScripts,
} from "@cdt/txlib";

import {
  EXPLORER_TX_URL,
  KEYS_DIR,
  KOIOS_URL,
  PACKAGE_ROOT,
  awaitOutputAt,
  fmtAda,
  loadBlueprint,
  loadWallets,
  lovelaceAt,
  makeLucid,
  pollUntil,
  sleep,
  submitAndConfirm,
  withRetry,
  type WalletInfo,
} from "./common.js";

const MINUTE_MS = 60_000n;
const CD1_TERM_MS = 12n * MINUTE_MS; // short maturity so the run finishes quickly
const CD2_TERM_MS = 365n * 24n * 60n * MINUTE_MS; // long maturity: early withdrawal
const CD2_ACCRUAL_WAIT_MS = 120_000; // let interest accrue before withdrawing early
const PRINCIPAL = 100_000_000n; // 100 tADA
const RATE_BPS = 450n; // 4.50% APR (simple interest)
const PENALTY_BPS = 1_000n; // 10% of accrued interest

async function findVaultUtxo(
  lucid: LucidEvolution,
  scripts: CdtScripts,
  unit: string,
): Promise<UTxO> {
  const utxos = await pollUntil(`vault UTxO holding ${unit}`, async () => {
    const found = await lucid.utxosAtWithUnit(scripts.vaultAddress, unit);
    return found.length > 0 ? found : undefined;
  });
  // Invariant check OUTSIDE the poll so a violation fails fast and loudly
  // instead of being retried into a generic timeout.
  if (utxos.length !== 1) {
    throw new Error(`expected exactly 1 vault UTxO for ${unit}, got ${utxos.length}`);
  }
  return utxos[0]!;
}

async function waitWallClock(untilMs: bigint, label: string): Promise<void> {
  const target = Number(untilMs);
  for (;;) {
    const remaining = target - Date.now();
    if (remaining <= 0) return;
    console.log(`  waiting for ${label}: ${Math.ceil(remaining / 1000)}s remaining...`);
    await sleep(Math.min(remaining, 30_000));
  }
}

interface CdRecordBase {
  depositId: string;
  terms: CDTerms;
  unit: string;
  locked: bigint;
  mintTxHash: string;
  settleTxHash: string;
  payout: bigint;
  memberFee: bigint;
  memberDelta: bigint;
  /** The slot-aligned lower validity bound of the settle tx (POSIX ms). */
  validFrom: bigint;
}

type CdRecord =
  | (CdRecordBase & { settleKind: "redeem" })
  | (CdRecordBase & {
      settleKind: "early-withdraw";
      accrued: bigint;
      penalty: bigint;
      remainder: bigint;
      issuerDelta: bigint;
    });

interface MintedCd {
  depositId: string;
  terms: CDTerms;
  unit: string;
  locked: bigint;
  txHash: string;
}

/**
 * Mint a CD in the exact shape the on-chain `cdt_mint` policy requires: ONE
 * vault output carrying the minted CDT itself, `principal + full_interest`
 * lovelace, and the inline `CDDatum` (the policy's `locks_cd_in_vault`
 * demands the token INSIDE the vault output — see
 * onchain/validators/cdt_mint.ak). At settlement the CDT is burned straight
 * out of the collected vault input, so the member never holds it directly.
 *
 * Note: `@cdt/txlib`'s `buildMintTx` pays the CDT to the owner instead of
 * the vault (it was validated against always-true fixture scripts), which
 * the real policy rejects — so the mint is built here; the txlib redeem /
 * early-withdraw builders match the real vault validator and are reused.
 */
async function mintCd(
  lucid: LucidEvolution,
  scripts: CdtScripts,
  issuer: WalletInfo,
  member: WalletInfo,
  oracle: WalletInfo,
  depositId: string,
  termMs: bigint,
): Promise<MintedCd> {
  const start = BigInt(Date.now());
  const terms: CDTerms = {
    issuer: issuer.vkh,
    depositId: fromText(depositId),
    principal: PRINCIPAL,
    rateBps: RATE_BPS,
    start,
    maturity: start + termMs,
    penaltyBps: PENALTY_BPS,
  };

  console.log(`\nMinting CD "${depositId}"`);
  console.log(`  principal ${fmtAda(terms.principal)}, rate ${terms.rateBps} bps, penalty ${terms.penaltyBps} bps`);
  console.log(`  start    ${new Date(Number(terms.start)).toISOString()}`);
  console.log(`  maturity ${new Date(Number(terms.maturity)).toISOString()}`);

  lucid.selectWallet.fromPrivateKey(issuer.privateKey);
  const datum: CDDatum = {
    owner: member.vkh,
    issuer: terms.issuer,
    deposit_id: terms.depositId,
    principal: terms.principal,
    rate_bps: terms.rateBps,
    start: terms.start,
    maturity: terms.maturity,
    penalty_bps: terms.penaltyBps,
    cdt_policy: scripts.policyId,
  };
  const unit = toUnit(scripts.policyId, terms.depositId);
  const locked =
    terms.principal +
    fullInterest(terms.principal, terms.rateBps, terms.start, terms.maturity);

  const signed = await withRetry("build mint tx", async () => {
    const tx = await lucid
      .newTx()
      .mintAssets({ [unit]: 1n }, Data.to({ MintCD: { datum } }, MintRedeemer))
      .attach.MintingPolicy(scripts.mintPolicy)
      .pay.ToContract(
        scripts.vaultAddress,
        { kind: "inline", value: Data.to(datum, CDDatum) },
        { lovelace: locked, [unit]: 1n },
      )
      .addSignerKey(scripts.oracleVkh)
      .complete();
    // Issuer funds/signs; the oracle co-signs to attest the bank deposit.
    return tx.sign.withWallet().sign.withPrivateKey(oracle.privateKey).complete();
  });
  console.log(`  locking ${fmtAda(locked)} + the CDT at the vault (${scripts.vaultAddress.slice(0, 24)}...)`);
  const txHash = await submitAndConfirm(lucid, signed, `mint ${depositId}`);

  // Wait until the vault UTxO (which carries the CDT) is indexed before any
  // dependent build. (It is re-fetched by the settle step.)
  await findVaultUtxo(lucid, scripts, unit);
  console.log("  vault UTxO (with CDT) is visible via Koios.");

  return { depositId, terms, unit, locked, txHash };
}

/**
 * Settle a minted CD as the member: redeem at maturity or withdraw early.
 * Shared orchestration for both paths — snapshot balances, build + sign the
 * settle tx, submit, wait for the outputs to be indexed, and report observed
 * balance deltas to the lovelace.
 */
async function settleCd(
  lucid: LucidEvolution,
  scripts: CdtScripts,
  blueprint: Blueprint,
  cd: MintedCd,
  member: WalletInfo,
  issuer: WalletInfo,
  oracle: WalletInfo,
  kind: CdRecord["settleKind"],
): Promise<CdRecord> {
  const vaultUtxo = await findVaultUtxo(lucid, scripts, cd.unit);
  const [memberBefore, issuerBefore] = await Promise.all([
    lovelaceAt(lucid, member.address),
    lovelaceAt(lucid, issuer.address),
  ]);

  lucid.selectWallet.fromPrivateKey(member.privateKey);
  const common = { scripts, blueprint, oracleVkh: oracle.vkh, vaultUtxo, ownerAddress: member.address };
  const settle = await withRetry(`build ${kind} tx`, async () => {
    if (kind === "redeem") {
      const built = await buildRedeemTx(lucid, common);
      const signedTx = await built.tx.sign.withWallet().complete();
      return { kind, built, signedTx } as const;
    }
    const built = await buildEarlyWithdrawTx(lucid, {
      ...common,
      issuerAddress: issuer.address,
      // The mempool validates the lower bound against the node's LEDGER TIP
      // slot, which can trail wall-clock time by a full preview block gap
      // (1-2 min observed). Back-date the withdrawal so the bound is already
      // behind the tip; payout math is computed at this same instant. Still
      // >= datum.start: the mint confirmation + accrual wait guarantee the
      // CD started more than 2 minutes ago.
      withdrawAt: BigInt(Date.now() - 120_000),
    });
    const signedTx = await built.tx.sign.withWallet().complete();
    return { kind, built, signedTx } as const;
  });

  const fee = settle.signedTx.toTransaction().body().fee();
  if (settle.kind === "redeem") {
    console.log(`  payout: ${fmtAda(settle.built.payout)} (${settle.built.payout} lovelace), fee ${fee} lovelace`);
  } else {
    console.log(
      `  accrued ${settle.built.accrued} lovelace, penalty ${settle.built.penalty} lovelace, payout ${settle.built.payout} lovelace, remainder to issuer ${settle.built.remainder} lovelace, fee ${fee} lovelace`,
    );
  }

  const settleTxHash = await submitAndConfirm(lucid, settle.signedTx, `${kind} ${cd.depositId}`);

  // Wait until the payout output is indexed so the balance reads are not stale.
  await awaitOutputAt(lucid, member.address, settleTxHash, `${kind} payout`);
  if (settle.kind === "early-withdraw" && settle.built.remainder > 0n) {
    await awaitOutputAt(lucid, issuer.address, settleTxHash, "issuer remainder");
  }
  const [memberAfter, issuerAfter] = await Promise.all([
    lovelaceAt(lucid, member.address),
    lovelaceAt(lucid, issuer.address),
  ]);
  const memberDelta = memberAfter - memberBefore;
  console.log(`  member balance delta: ${memberDelta} lovelace (expected ${settle.built.payout - fee})`);

  const base: CdRecordBase = {
    depositId: cd.depositId,
    terms: cd.terms,
    unit: cd.unit,
    locked: cd.locked,
    mintTxHash: cd.txHash,
    settleTxHash,
    payout: settle.built.payout,
    memberFee: fee,
    memberDelta,
    validFrom: settle.built.validFrom,
  };
  if (settle.kind === "redeem") {
    return { ...base, settleKind: "redeem" };
  }
  const issuerDelta = issuerAfter - issuerBefore;
  console.log(`  issuer balance delta: ${issuerDelta} lovelace (expected ${settle.built.remainder})`);
  return {
    ...base,
    settleKind: "early-withdraw",
    accrued: settle.built.accrued,
    penalty: settle.built.penalty,
    remainder: settle.built.remainder,
    issuerDelta,
  };
}

function buildReport(params: {
  runDate: string;
  wallets: Record<"issuer" | "member" | "oracle", WalletInfo>;
  scripts: CdtScripts;
  fundingTxNote: string;
  cds: CdRecord[];
}): string {
  const { runDate, wallets, scripts, cds } = params;
  const link = (hash: string) => `[\`${hash}\`](${EXPLORER_TX_URL}${hash})`;
  const lines: string[] = [];
  lines.push("# CDT preview-testnet run");
  lines.push("");
  lines.push("Verifiable evidence of the full Certificate of Deposit Token (CDT) lifecycle");
  lines.push("executed on the **Cardano preview testnet** (real network, not an emulator).");
  lines.push("Every transaction hash below is confirmable on-chain.");
  lines.push("");
  lines.push(`- Run date: ${runDate}`);
  lines.push("- Network: preview (slot length 1 s)");
  lines.push(`- Provider: Koios public preview endpoint (\`${KOIOS_URL}\`)`);
  lines.push("- Explorer: <https://preview.cardanoscan.io>");
  lines.push("");
  lines.push("## Parties (public addresses)");
  lines.push("");
  lines.push("| Role | Address | Payment vkh |");
  lines.push("|------|---------|-------------|");
  lines.push(`| Issuer (credit union) | \`${wallets.issuer.address}\` | \`${wallets.issuer.vkh}\` |`);
  lines.push(`| Member (CD owner) | \`${wallets.member.address}\` | \`${wallets.member.vkh}\` |`);
  lines.push(`| Oracle (deposit attestor) | \`${wallets.oracle.address}\` | \`${wallets.oracle.vkh}\` |`);
  lines.push("");
  lines.push("## Scripts");
  lines.push("");
  lines.push(`- CDT policy id: \`${scripts.policyId}\``);
  lines.push(`- Vault script hash: \`${scripts.vaultHash}\``);
  lines.push(`- Vault address: \`${scripts.vaultAddress}\``);
  lines.push(`- Blueprint: \`onchain/plutus.json\` (Aiken, Plutus v3), mint policy parameterized by \`(oracle_vkh, vault_hash)\``);
  lines.push("");
  lines.push("## Funding");
  lines.push("");
  lines.push(params.fundingTxNote);
  lines.push("");
  for (const [i, cd] of cds.entries()) {
    lines.push(`## CD ${i + 1}: \`${cd.depositId}\` (${cd.settleKind === "redeem" ? "redeemed at maturity" : "early withdrawal with penalty"})`);
    lines.push("");
    lines.push("| Term | Value |");
    lines.push("|------|-------|");
    lines.push(`| Principal | ${fmtAda(cd.terms.principal)} (${cd.terms.principal} lovelace) |`);
    lines.push(`| Rate | ${cd.terms.rateBps} bps |`);
    lines.push(`| Start | ${new Date(Number(cd.terms.start)).toISOString()} (${cd.terms.start}) |`);
    lines.push(`| Maturity | ${new Date(Number(cd.terms.maturity)).toISOString()} (${cd.terms.maturity}) |`);
    lines.push(`| Penalty | ${cd.terms.penaltyBps} bps of accrued interest |`);
    lines.push(`| CDT unit | \`${cd.unit}\` |`);
    lines.push(`| Locked at vault | ${fmtAda(cd.locked)} (${cd.locked} lovelace = principal + full interest) |`);
    lines.push("");
    lines.push(`- Mint (issuer funds vault with principal + interest + the CDT, oracle co-signs): ${link(cd.mintTxHash)}`);
    if (cd.settleKind === "redeem") {
      lines.push(`- Redeem at maturity (member burns CDT, receives principal + full interest): ${link(cd.settleTxHash)}`);
      lines.push("");
      lines.push(`  - Tx validity lower bound: ${new Date(Number(cd.validFrom)).toISOString()} (>= maturity, slot-aligned)`);
      lines.push(`  - Payout to member: **${cd.payout} lovelace** (${fmtAda(cd.payout)})`);
    } else {
      lines.push(`- Early withdrawal (member burns CDT before maturity): ${link(cd.settleTxHash)}`);
      lines.push("");
      lines.push(`  - Effective withdrawal time (tx validity lower bound): ${new Date(Number(cd.validFrom)).toISOString()}`);
      lines.push(`  - Accrued interest at withdrawal: ${cd.accrued} lovelace`);
      lines.push(`  - Penalty withheld (${cd.terms.penaltyBps} bps of accrued): ${cd.penalty} lovelace`);
      lines.push(`  - Payout to member: **${cd.payout} lovelace** (principal + accrued - penalty)`);
      lines.push(`  - Remainder returned to issuer: **${cd.remainder} lovelace** (observed issuer delta: ${cd.issuerDelta} lovelace)`);
    }
    lines.push(`  - Member tx fee: ${cd.memberFee} lovelace`);
    lines.push(`  - Observed member balance delta: ${cd.memberDelta} lovelace (= payout - fee: ${cd.payout - cd.memberFee})`);
    lines.push("");
  }
  lines.push("## How to verify");
  lines.push("");
  lines.push("Open any transaction link above on preview.cardanoscan.io, or query Koios:");
  lines.push("");
  lines.push("```sh");
  const exampleHash = cds[0]?.mintTxHash ?? "<tx-hash>";
  lines.push(`curl -s ${KOIOS_URL}/tx_info -H 'content-type: application/json' \\`);
  lines.push(`  -d '{"_tx_hashes":["${exampleHash}"]}'`);
  lines.push("```");
  lines.push("");
  lines.push("Rerun instructions: see [README.md](./README.md).");
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  console.log(`Network: preview  (provider: ${KOIOS_URL})`);
  const lucid = await makeLucid();
  const wallets = await loadWallets(lucid);
  const { issuer, member, oracle } = wallets;
  const blueprint = loadBlueprint();
  const scripts = resolveCdtScripts(lucid, { blueprint, oracleVkh: oracle.vkh });

  console.log(`CDT policy id: ${scripts.policyId}`);
  console.log(`Vault address: ${scripts.vaultAddress}`);

  // Preflight: both spending wallets must be funded.
  const [issuerBalance, memberBalance] = await Promise.all([
    lovelaceAt(lucid, issuer.address),
    lovelaceAt(lucid, member.address),
  ]);
  console.log(`issuer balance: ${fmtAda(issuerBalance)}`);
  console.log(`member balance: ${fmtAda(memberBalance)}`);
  if (issuerBalance < 250_000_000n || memberBalance < 20_000_000n) {
    console.error(
      "\nInsufficient funds. Run 'npm run fund' first (issuer needs >= 250 tADA, member >= 20 tADA).",
    );
    process.exit(2);
  }

  const iso = new Date().toISOString();
  const runDate = iso;
  const dateTag = `${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 16).replace(":", "")}`;
  const cds: CdRecord[] = [];

  // ------------------------------------------------------------------
  // CD 1: mint, wait for maturity, redeem.
  // ------------------------------------------------------------------
  const cd1 = await mintCd(
    lucid, scripts, issuer, member, oracle,
    `TESTNET-${dateTag}-001`, CD1_TERM_MS,
  );

  await waitWallClock(cd1.terms.maturity + 20_000n, "CD 1 maturity (+20 s slot-safety margin)");

  console.log(`\nRedeeming CD "${cd1.depositId}" as the member`);
  cds.push(await settleCd(lucid, scripts, blueprint, cd1, member, issuer, oracle, "redeem"));

  // ------------------------------------------------------------------
  // CD 2: mint with a 1-year maturity, then withdraw early with penalty.
  // ------------------------------------------------------------------
  const cd2 = await mintCd(
    lucid, scripts, issuer, member, oracle,
    `TESTNET-${dateTag}-002`, CD2_TERM_MS,
  );

  console.log(`\nLetting interest accrue for ${CD2_ACCRUAL_WAIT_MS / 1000}s before the early withdrawal...`);
  await sleep(CD2_ACCRUAL_WAIT_MS);

  console.log(`Withdrawing CD "${cd2.depositId}" early as the member`);
  cds.push(await settleCd(lucid, scripts, blueprint, cd2, member, issuer, oracle, "early-withdraw"));

  // ------------------------------------------------------------------
  // Evidence report.
  // ------------------------------------------------------------------
  const report = buildReport({
    runDate,
    wallets,
    scripts,
    fundingTxNote:
      "The issuer wallet was funded from the official preview faucet " +
      "(<https://docs.cardano.org/cardano-testnets/tools/faucet>) and distributed " +
      "working balances to the member and oracle wallets (`npm run fund`).",
    cds,
  });
  const reportPath = join(PACKAGE_ROOT, "TESTNET-RUN.md");
  writeFileSync(reportPath, report);
  console.log(`\nEvidence report written to ${reportPath}`);

  // Machine-readable run record (gitignored alongside the keys).
  const record = {
    runDate,
    network: "preview",
    provider: KOIOS_URL,
    policyId: scripts.policyId,
    vaultAddress: scripts.vaultAddress,
    cds,
  };
  writeFileSync(
    join(KEYS_DIR, `run-${dateTag}.json`),
    JSON.stringify(record, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2),
  );

  console.log("\nLifecycle complete. Tx hashes:");
  for (const cd of cds) {
    console.log(`  ${cd.depositId} mint:   ${cd.mintTxHash}`);
    console.log(`  ${cd.depositId} ${cd.settleKind}: ${cd.settleTxHash}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
