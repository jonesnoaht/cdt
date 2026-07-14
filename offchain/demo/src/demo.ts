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
import { randomUUID } from "node:crypto";

import { toText } from "@lucid-evolution/lucid";

import {
  ACCOUNT_HOLDER_CREDENTIAL,
  createHolder,
  createIssuer,
  createPresentation,
  INSURED_INSTITUTION_CREDENTIAL,
  issueCredential,
  verifyPresentation,
  type VerifiablePresentation,
  type VerifiableCredential,
  type VerifyResult,
} from "@cdt/credentials";
import { earlyPayout } from "@cdt/txlib";

import { BankLedger } from "./bank.js";
import {
  advancePast,
  circulatingSupply,
  depositIdToAssetName,
  earlyWithdrawCd,
  findVaultUtxo,
  fullInterestOf,
  lovelaceAt,
  maturePayoutOf,
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
// Onboarding gate
// ---------------------------------------------------------------------------

/** Credentials are valid for one year in this ceremony. */
const CREDENTIAL_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * The credit union's onboarding policy: on top of @cdt/credentials'
 * verification (signatures, NCUA → institution trust chain, holder binding,
 * validity windows, challenge), the presentation must contain an
 * InsuredInstitutionCredential AND an AccountHolderCredential about the
 * holder — a mere chain-of-trust with some other credential type is not
 * enough to open a share certificate.
 */
function onboardingGate(
  presentation: VerifiablePresentation,
  trustedRoot: string,
  challenge: string,
): VerifyResult {
  const verified = verifyPresentation(presentation, {
    trustedRoots: [trustedRoot],
    challenge,
  });
  if (!verified.ok) return verified;
  for (const required of [INSURED_INSTITUTION_CREDENTIAL, ACCOUNT_HOLDER_CREDENTIAL]) {
    if (!presentation.verifiableCredential.some((vc) => vc.type.includes(required))) {
      return { ok: false, reason: `missing ${required}` };
    }
  }
  const holderVc = presentation.verifiableCredential.find((vc) =>
    vc.type.includes(ACCOUNT_HOLDER_CREDENTIAL),
  );
  if (holderVc?.credentialSubject.id !== presentation.holder) {
    return {
      ok: false,
      reason: `${ACCOUNT_HOLDER_CREDENTIAL} subject is not the presentation holder`,
    };
  }
  return { ok: true };
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
  const ncua = createIssuer("National Credit Union Administration");
  const creditUnionId = createIssuer("CampusUSA Credit Union");
  const memberId = createHolder();
  say(
    `NCUA root DID         : ${shortHash(ncua.did)}`,
    `Credit union DID      : ${shortHash(creditUnionId.did)}`,
    `Member DID            : ${shortHash(memberId.did)}`,
  );

  const institutionVc = issueCredential(
    ncua,
    creditUnionId.did,
    INSURED_INSTITUTION_CREDENTIAL,
    {
      legalName: "CampusUSA Credit Union",
      charterNumber: "68589",
      insurance: "NCUA share insurance",
    },
    { expiresInMs: CREDENTIAL_TTL_MS },
  );
  say("", "NCUA issues InsuredInstitutionCredential to the credit union ✔");

  const accountHolderVc = issueCredential(
    creditUnionId,
    memberId.did,
    ACCOUNT_HOLDER_CREDENTIAL,
    {
      accountRef: "acct-member-001",
      kycLevel: "full",
    },
    { expiresInMs: CREDENTIAL_TTL_MS },
  );
  say("Credit union issues AccountHolderCredential to the member ✔");

  // The verifier (the onboarding gate) hands the member a fresh challenge
  // nonce; the member echoes it in the presentation proof (replay protection).
  const challenge = randomUUID();
  const presentation = createPresentation(
    memberId,
    [institutionVc, accountHolderVc],
    { challenge },
  );
  const gate = onboardingGate(presentation, ncua.did, challenge);
  assert.equal(gate.ok, true, gate.ok ? undefined : gate.reason);
  say(
    "Member presents both credentials against a verifier challenge; the gate",
    "verifies signatures, the chain of trust (NCUA → credit union → member),",
    "the required credential types, validity windows, and the challenge ✔",
    "ONBOARDING PASSES",
  );

  // ... and show that tampering is caught.
  const tampered: VerifiableCredential = {
    ...accountHolderVc,
    credentialSubject: { ...accountHolderVc.credentialSubject, kycLevel: "none" },
  };
  const tamperedPresentation = createPresentation(
    memberId,
    [institutionVc, tampered],
    { challenge },
  );
  const tamperedGate = onboardingGate(tamperedPresentation, ncua.did, challenge);
  assert.equal(tamperedGate.ok, false);
  say(
    "",
    "Counter-example: a tampered AccountHolderCredential (kycLevel edited",
    `after signing) is REJECTED — "${tamperedGate.ok ? "" : tamperedGate.reason}" ✔`,
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
  const interest = fullInterestOf(cd.datum);
  say(
    "The oracle checked the core-banking ledger and co-signed the mint tx",
    "together with the credit union (policy requires the oracle signature).",
    "",
    `Mint tx              : ${shortHash(cd.mintTxHash)}`,
    `CDT asset            : ${shortHash(contracts.policyId)}.${toText(depositIdHex)}`,
    `Vault now holds      : ${ada(vaultUtxo.assets["lovelace"] ?? 0n)} + 1 CDT`,
    `  principal          : ${ada(cd.datum.principal)}`,
    `  full interest      : ${ada(interest)} (450 bps × 120 s / year)`,
    `Term                 : start ${cd.datum.start} → maturity ${cd.datum.maturity} (POSIX ms)`,
    `Bank deposit status  : ${bank.getDeposit(fiatDeposit.id).status}`,
  );
  assert.equal(vaultUtxo.assets["lovelace"], cd.locked);
  assert.equal(vaultUtxo.assets[cd.unit], 1n);

  // -------------------------------------------------------------------------
  step("Time passes… the CD matures; the member redeems");
  // -------------------------------------------------------------------------
  advancePast(ctx, cd.datum.maturity);
  say(`Emulator advanced past maturity (now = ${emulator.now()}).`);

  const expectedPayout = maturePayoutOf(cd.datum);
  const memberBefore = await lovelaceAt(ctx, member.account.address);
  const redemption = await redeemCd(ctx, cd);
  const memberAfter = await lovelaceAt(ctx, member.account.address);
  bank.closeDeposit(fiatDeposit.id);

  assert.equal(redemption.payout, expectedPayout);
  assert.equal(memberAfter - memberBefore, cd.locked - redemption.fee);
  assert.equal(circulatingSupply(ctx, cd.unit), 0n);
  say(
    "The member burns the CDT and the vault releases principal + interest",
    "(transaction built by @cdt/txlib's buildRedeemTx).",
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
  advancePast(ctx, cd2.datum.start + 60_000n);
  assert.ok(BigInt(emulator.now()) < cd2.datum.maturity, "still before maturity");

  const memberBefore2 = await lovelaceAt(ctx, member.account.address);
  const issuerBefore = await lovelaceAt(ctx, creditUnion.account.address);
  const withdrawal = await earlyWithdrawCd(ctx, cd2);
  const memberAfter2 = await lovelaceAt(ctx, member.account.address);
  const issuerAfter = await lovelaceAt(ctx, creditUnion.account.address);
  bank.closeDeposit(fiatDeposit2.id);

  // Independent recomputation via @cdt/txlib at the slot-aligned time the
  // withdrawal actually used — not just internal consistency of the result.
  assert.equal(
    withdrawal.payout,
    earlyPayout(
      cd2.datum.principal,
      cd2.datum.rate_bps,
      cd2.datum.start,
      cd2.datum.maturity,
      cd2.datum.penalty_bps,
      withdrawal.at,
    ),
  );
  assert.equal(
    withdrawal.payout,
    cd2.datum.principal + withdrawal.accrued - withdrawal.penalty,
  );
  assert.equal(issuerAfter - issuerBefore, withdrawal.issuerReturn);
  assert.equal(
    memberAfter2 - memberBefore2,
    cd2.locked - withdrawal.issuerReturn - withdrawal.fee,
  );
  assert.equal(circulatingSupply(ctx, cd2.unit), 0n);
  say(
    `At t = start + ${(withdrawal.at - cd2.datum.start) / 1000n} s (slot-aligned) the member withdraws early:`,
    "",
    `  accrued interest   : ${ada(withdrawal.accrued)}`,
    `  penalty (10%)      : ${ada(withdrawal.penalty)}`,
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
