/**
 * CDT flagship demo — the full certificate-of-deposit token lifecycle,
 * narrated, on an in-process Cardano emulator (no docker, no network).
 *
 *   npm run demo
 *
 * Cast:
 *   - CampusUSA Credit Union (issuer) — NCUA-insured institution
 *   - A member (customer) — buys a 12-month CD
 *   - The deposit oracle — attests that fiat actually landed at the bank
 */

import assert from "node:assert/strict";

import { toText } from "@lucid-evolution/lucid";

import { BankLedger } from "./bank.js";
import {
  createPresentation,
  generateDidActor,
  issueCredential,
  verifyPresentation,
  type VerifiableCredential,
} from "./credentials.js";
import { accrued, earlyPayout, fullInterest, maturePayout, penaltyFee } from "./interest.js";
import {
  advancePast,
  circulatingSupply,
  depositIdToAssetName,
  earlyWithdrawCd,
  findVaultUtxo,
  lovelaceAt,
  mintCd,
  redeemCd,
  setupChain,
} from "./lifecycle.js";

/**
 * Demo scale: $1 ⇒ 1 ADA, i.e. 10_000 lovelace per US cent, so the on-chain
 * principal is always derived from the fiat deposit on the bank's books.
 */
const LOVELACE_PER_CENT = 10_000n;

/** The demo compresses the 12-month term to 120 seconds of emulator time. */
const DEMO_TERM_MS = 120_000n;

// ---------------------------------------------------------------------------
// Narration helpers
// ---------------------------------------------------------------------------

let stepNumber = 0;

function step(title: string): void {
  stepNumber += 1;
  console.log();
  console.log(`${"=".repeat(74)}`);
  console.log(`STEP ${stepNumber} — ${title}`);
  console.log(`${"=".repeat(74)}`);
}

function say(...lines: string[]): void {
  for (const line of lines) console.log(`  ${line}`);
}

function ada(lovelace: bigint): string {
  const whole = lovelace / 1_000_000n;
  const frac = (lovelace % 1_000_000n).toString().padStart(6, "0");
  return `${whole.toLocaleString("en-US")}.${frac} ADA`;
}

function usd(cents: bigint): string {
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `$${whole.toLocaleString("en-US")}.${frac}`;
}

function shortHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

// ---------------------------------------------------------------------------
// The story
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("CERTIFICATE OF DEPOSIT TOKEN (CDT) — END-TO-END LIFECYCLE DEMO");
  console.log("CampusUSA Credit Union pilot, running on a local Lucid emulator");

  // -------------------------------------------------------------------------
  step("Seed the chain: three wallets on a fresh emulator");
  // -------------------------------------------------------------------------
  const ctx = await setupChain();
  const { emulator, creditUnion, member, oracle, contracts } = ctx;
  say(
    `${creditUnion.name} (issuer)  ${shortHash(creditUnion.account.address)}  key hash ${shortHash(creditUnion.vkh)}`,
    `${member.name} (customer)              ${shortHash(member.account.address)}  key hash ${shortHash(member.vkh)}`,
    `${oracle.name} (attestor)      ${shortHash(oracle.account.address)}  key hash ${shortHash(oracle.vkh)}`,
    "",
    `cd_vault script address : ${shortHash(contracts.vaultAddress)}`,
    `cdt_mint policy id      : ${contracts.policyId}`,
    "(policy is parameterized by the oracle key hash and the vault script hash)",
  );

  // -------------------------------------------------------------------------
  step("Credential ceremony: NCUA → credit union → member");
  // -------------------------------------------------------------------------
  const ncua = generateDidActor();
  const creditUnionId = generateDidActor();
  const memberId = generateDidActor();
  say(
    `NCUA root DID         : ${shortHash(ncua.did)}`,
    `Credit union DID      : ${shortHash(creditUnionId.did)}`,
    `Member DID            : ${shortHash(memberId.did)}`,
  );

  const institutionVc = issueCredential(ncua, "InsuredInstitutionCredential", {
    id: creditUnionId.did,
    legalName: "CampusUSA Credit Union",
    charterNumber: "68589",
    insurance: "NCUA share insurance",
  });
  say("", "NCUA issues InsuredInstitutionCredential to the credit union ✔");

  const accountHolderVc = issueCredential(creditUnionId, "AccountHolderCredential", {
    id: memberId.did,
    accountRef: "acct-member-001",
    kycLevel: "full",
  });
  say("Credit union issues AccountHolderCredential to the member ✔");

  const presentation = createPresentation(memberId, [institutionVc, accountHolderVc]);
  const gate = verifyPresentation(presentation, {
    trustedRoot: ncua.did,
    institutionCredentialType: "InsuredInstitutionCredential",
    holderCredentialType: "AccountHolderCredential",
  });
  assert.equal(gate.ok, true, gate.reason);
  say(
    "Member presents both credentials; gate verifies signatures, chain of",
    "trust (NCUA → credit union → member) and expiry ✔  ONBOARDING PASSES",
  );

  // ... and show that tampering is caught.
  const tampered: VerifiableCredential = {
    ...accountHolderVc,
    credentialSubject: { ...accountHolderVc.credentialSubject, kycLevel: "none" },
  };
  const tamperedPresentation = createPresentation(memberId, [institutionVc, tampered]);
  const tamperedGate = verifyPresentation(tamperedPresentation, {
    trustedRoot: ncua.did,
    institutionCredentialType: "InsuredInstitutionCredential",
    holderCredentialType: "AccountHolderCredential",
  });
  assert.equal(tamperedGate.ok, false);
  say(
    "",
    "Counter-example: a tampered AccountHolderCredential (kycLevel edited",
    `after signing) is REJECTED — "${tamperedGate.reason}" ✔`,
  );

  // -------------------------------------------------------------------------
  step("Member funds a $10,000 CD at the (in-memory) bank");
  // -------------------------------------------------------------------------
  const bank = new BankLedger("CampusUSA");
  bank.openAccount("acct-member-001", "Member", 2_500_000n); // $25,000.00
  const product = bank.addProduct({
    id: "cd-12mo",
    name: "12-month share certificate",
    termMonths: 12,
    rateBps: 450,
    penaltyBps: 1000,
  });
  const fiatDeposit = bank.fundCdDeposit(
    "dep-001",
    "acct-member-001",
    product.id,
    1_000_000n, // $10,000.00
  );
  say(
    `Product: ${product.name} — ${product.rateBps} bps APR, early-withdrawal`,
    `penalty ${product.penaltyBps} bps of accrued interest`,
    "",
    `Member share account : ${usd(bank.getAccount("acct-member-001").balanceCents)} (was $25,000.00)`,
    `CD funding account   : ${usd(bank.getAccount(bank.cdFundingAccountId).balanceCents)}`,
    `Deposit ${fiatDeposit.id} status  : ${fiatDeposit.status}`,
  );

  // -------------------------------------------------------------------------
  step("Oracle attests the deposit; CDT is minted and the vault is funded");
  // -------------------------------------------------------------------------
  // Demo scale: $1 ⇒ 1 ADA, and a compressed 120-second "12-month" term so
  // maturity arrives while you watch. The math is identical at any scale.
  const depositIdHex = depositIdToAssetName("CDT-dep-001");
  const cd = await mintCd(ctx, depositIdHex, {
    principal: fiatDeposit.amountCents * LOVELACE_PER_CENT, // 10,000 ADA ≙ $10,000
    rateBps: BigInt(product.rateBps),
    termMs: DEMO_TERM_MS,
    penaltyBps: BigInt(product.penaltyBps),
  });
  bank.markTokenized(fiatDeposit.id, depositIdHex);
  const vaultUtxo = await findVaultUtxo(ctx, cd.unit);
  say(
    "The oracle checked the core-banking ledger and co-signed the mint tx",
    "together with the credit union (policy requires the oracle signature).",
    "",
    `Mint tx              : ${shortHash(cd.mintTxHash)}`,
    `CDT asset            : ${shortHash(contracts.policyId)}.${toText(depositIdHex)}`,
    `Vault now holds      : ${ada(vaultUtxo.assets.lovelace ?? 0n)} + 1 CDT`,
    `  principal          : ${ada(cd.terms.principal)}`,
    `  full interest      : ${ada(fullInterest(cd.terms))} (450 bps × 120 s / year)`,
    `Term                 : start ${cd.terms.start} → maturity ${cd.terms.maturity} (POSIX ms)`,
    `Bank deposit status  : ${bank.getDeposit(fiatDeposit.id).status}`,
  );
  assert.equal(vaultUtxo.assets.lovelace, cd.locked);
  assert.equal(vaultUtxo.assets[cd.unit], 1n);

  // -------------------------------------------------------------------------
  step("Time passes… the CD matures; the member redeems");
  // -------------------------------------------------------------------------
  advancePast(ctx, cd.terms.maturity);
  say(`Emulator advanced past maturity (now = ${emulator.now()}).`);

  const expectedPayout = maturePayout(cd.terms);
  const memberBefore = await lovelaceAt(ctx, member.account.address);
  const redemption = await redeemCd(ctx, cd);
  const memberAfter = await lovelaceAt(ctx, member.account.address);
  bank.closeDeposit(fiatDeposit.id);

  assert.equal(redemption.payout, expectedPayout);
  assert.equal(memberAfter - memberBefore, cd.locked - redemption.fee);
  assert.equal(circulatingSupply(ctx, cd.unit), 0n);
  say(
    "The member burns the CDT and the vault releases principal + interest.",
    "",
    `Redeem tx            : ${shortHash(redemption.txHash)}`,
    `Payout to member     : ${ada(redemption.payout)} (exactly principal + full interest)`,
    `Member balance       : ${ada(memberBefore)} → ${ada(memberAfter)} (Δ = payout − tx fee of ${ada(redemption.fee)})`,
    `CDT supply           : ${circulatingSupply(ctx, cd.unit)} (burned)`,
    `Bank deposit status  : ${bank.getDeposit(fiatDeposit.id).status}`,
  );

  // -------------------------------------------------------------------------
  step("Second CD: the early-withdrawal branch");
  // -------------------------------------------------------------------------
  const fiatDeposit2 = bank.fundCdDeposit(
    "dep-002",
    "acct-member-001",
    product.id,
    1_000_000n,
  );
  const depositIdHex2 = depositIdToAssetName("CDT-dep-002");
  const cd2 = await mintCd(ctx, depositIdHex2, {
    principal: fiatDeposit2.amountCents * LOVELACE_PER_CENT,
    rateBps: BigInt(product.rateBps),
    termMs: DEMO_TERM_MS,
    penaltyBps: BigInt(product.penaltyBps),
  });
  bank.markTokenized(fiatDeposit2.id, depositIdHex2);
  say(
    `A second $10,000 CD (${fiatDeposit2.id}) is funded and tokenized the same way.`,
    `Mint tx              : ${shortHash(cd2.mintTxHash)}`,
  );

  // Let roughly half the term elapse, then withdraw early.
  advancePast(ctx, cd2.terms.start + 60_000n);
  const t = BigInt(emulator.now());
  assert.ok(t < cd2.terms.maturity, "still before maturity");

  const acc = accrued(cd2.terms, t);
  const fee = penaltyFee(acc, cd2.terms.penaltyBps);
  const expectedEarly = earlyPayout(cd2.terms, t);

  const memberBefore2 = await lovelaceAt(ctx, member.account.address);
  const issuerBefore = await lovelaceAt(ctx, creditUnion.account.address);
  const withdrawal = await earlyWithdrawCd(ctx, cd2);
  const memberAfter2 = await lovelaceAt(ctx, member.account.address);
  const issuerAfter = await lovelaceAt(ctx, creditUnion.account.address);
  bank.closeDeposit(fiatDeposit2.id);

  assert.equal(withdrawal.payout, expectedEarly);
  assert.equal(issuerAfter - issuerBefore, withdrawal.issuerReturn);
  assert.equal(
    memberAfter2 - memberBefore2,
    cd2.locked - withdrawal.issuerReturn - withdrawal.fee,
  );
  assert.equal(circulatingSupply(ctx, cd2.unit), 0n);
  say(
    `At t = start + ${(t - cd2.terms.start) / 1000n} s the member withdraws early:`,
    "",
    `  accrued interest   : ${ada(acc)}`,
    `  penalty (10%)      : ${ada(fee)}`,
    `  early payout       : ${ada(withdrawal.payout)} (principal + accrued − penalty)`,
    `  back to issuer     : ${ada(withdrawal.issuerReturn)} (covers the ${ada(withdrawal.remainder)} remainder + min-ADA)`,
    "",
    `Withdraw tx          : ${shortHash(withdrawal.txHash)}`,
    `Member balance       : ${ada(memberBefore2)} → ${ada(memberAfter2)}`,
    `Issuer balance       : ${ada(issuerBefore)} → ${ada(issuerAfter)}`,
    `CDT supply           : ${circulatingSupply(ctx, cd2.unit)} (burned)`,
  );

  // -------------------------------------------------------------------------
  console.log();
  console.log("=".repeat(74));
  console.log("DEMO COMPLETE — both lifecycles settled to the exact lovelace.");
  console.log("=".repeat(74));
}

main().catch((error) => {
  console.error();
  console.error("DEMO FAILED:", error);
  process.exitCode = 1;
});
