/**
 * Fast unit tests for the demo's building blocks: @cdt/txlib's interest math
 * (the off-chain mirror of onchain/lib/cdt/interest.ak), the @cdt/credentials
 * verifiable-credential ceremony, and the demo's in-memory bank ledger.
 */

import { describe, expect, it } from "vitest";

import {
  ACCOUNT_HOLDER_CREDENTIAL,
  createHolder,
  createIssuer,
  createPresentation,
  didFromPublicKey,
  INSURED_INSTITUTION_CREDENTIAL,
  issueCredential,
  publicKeyFromDid,
  verifyPresentation,
} from "@cdt/credentials";
import {
  accrued,
  earlyPayout,
  fullInterest,
  maturePayout,
  penaltyFee,
  YEAR_MS,
} from "@cdt/txlib";

import { BankLedger } from "../src/bank.js";

describe("interest math (@cdt/txlib mirror of lib/cdt/interest.ak)", () => {
  const principal = 10_000_000_000n;
  const rateBps = 450n;
  const start = 0n;
  const maturity = YEAR_MS;
  const penaltyBps = 1_000n;

  it("computes one year of full interest", () => {
    expect(fullInterest(principal, rateBps, start, maturity)).toBe(450_000_000n);
    expect(maturePayout(principal, rateBps, start, maturity)).toBe(10_450_000_000n);
  });

  it("clamps accrual to the term", () => {
    expect(accrued(principal, rateBps, start, maturity, -5n)).toBe(0n);
    expect(accrued(principal, rateBps, start, maturity, YEAR_MS * 2n)).toBe(
      fullInterest(principal, rateBps, start, maturity),
    );
  });

  it("floors the 120-second demo term the same way the validator does", () => {
    // 10^10 * 450 * 120_000 / (10^4 * 31_557_600_000) = 1711.15… -> 1711
    expect(fullInterest(principal, rateBps, 0n, 120_000n)).toBe(1_711n);
  });

  it("applies the early-withdrawal penalty to accrued interest only", () => {
    const t = YEAR_MS / 2n;
    expect(accrued(principal, rateBps, start, maturity, t)).toBe(225_000_000n);
    expect(penaltyFee(principal, rateBps, start, maturity, penaltyBps, t)).toBe(
      22_500_000n,
    );
    expect(earlyPayout(principal, rateBps, start, maturity, penaltyBps, t)).toBe(
      10_000_000_000n + 202_500_000n,
    );
  });
});

describe("verifiable credentials (@cdt/credentials)", () => {
  const CHALLENGE = "nonce-units-test";

  it("issues, presents, and verifies the NCUA → CU → member chain", () => {
    const ncua = createIssuer("NCUA");
    const cu = createIssuer("CampusUSA Credit Union");
    const member = createHolder();

    const institutionVc = issueCredential(
      ncua,
      cu.did,
      INSURED_INSTITUTION_CREDENTIAL,
      { charterNumber: "68589" },
    );
    const holderVc = issueCredential(cu, member.did, ACCOUNT_HOLDER_CREDENTIAL, {
      kycLevel: "full",
    });

    const presentation = createPresentation(member, [institutionVc, holderVc], {
      challenge: CHALLENGE,
    });
    const result = verifyPresentation(presentation, {
      trustedRoots: [ncua.did],
      challenge: CHALLENGE,
    });
    expect(result).toEqual({ ok: true });
  });

  it("round-trips public keys through did:key", () => {
    const holder = createHolder();
    const resolved = publicKeyFromDid(holder.did);
    expect(resolved.equals(holder.keys.publicKey)).toBe(true);
    expect(didFromPublicKey(resolved)).toBe(holder.did);
  });

  it("rejects tampered credentials and untrusted roots", () => {
    const ncua = createIssuer("NCUA");
    const rogue = createIssuer("Rogue Root");
    const cu = createIssuer("CampusUSA Credit Union");
    const member = createHolder();

    const institutionVc = issueCredential(
      ncua,
      cu.did,
      INSURED_INSTITUTION_CREDENTIAL,
      {},
    );
    const holderVc = issueCredential(cu, member.did, ACCOUNT_HOLDER_CREDENTIAL, {
      kycLevel: "full",
    });

    // Tampering breaks the credential signature.
    const tampered = {
      ...holderVc,
      credentialSubject: { ...holderVc.credentialSubject, kycLevel: "forged" },
    };
    const tamperedResult = verifyPresentation(
      createPresentation(member, [institutionVc, tampered], {
        challenge: CHALLENGE,
      }),
      { trustedRoots: [ncua.did], challenge: CHALLENGE },
    );
    expect(tamperedResult.ok).toBe(false);
    expect(tamperedResult.ok ? "" : tamperedResult.reason).toMatch(/tampered/);

    // A chain rooted somewhere else is refused.
    const rogueInstitutionVc = issueCredential(
      rogue,
      cu.did,
      INSURED_INSTITUTION_CREDENTIAL,
      {},
    );
    const rogueResult = verifyPresentation(
      createPresentation(member, [rogueInstitutionVc, holderVc], {
        challenge: CHALLENGE,
      }),
      { trustedRoots: [ncua.did], challenge: CHALLENGE },
    );
    expect(rogueResult.ok).toBe(false);
    expect(rogueResult.ok ? "" : rogueResult.reason).toMatch(/trusted root/);
  });

  it("rejects expired credentials", () => {
    const ncua = createIssuer("NCUA");
    const cu = createIssuer("CampusUSA Credit Union");
    const member = createHolder();

    const institutionVc = issueCredential(
      ncua,
      cu.did,
      INSURED_INSTITUTION_CREDENTIAL,
      {},
    );
    const holderVc = issueCredential(
      cu,
      member.did,
      ACCOUNT_HOLDER_CREDENTIAL,
      { kycLevel: "full" },
      { expiresInMs: 1000 },
    );
    const presentation = createPresentation(member, [institutionVc, holderVc], {
      challenge: CHALLENGE,
    });
    const result = verifyPresentation(presentation, {
      trustedRoots: [ncua.did],
      challenge: CHALLENGE,
      now: new Date(Date.now() + 5000),
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toMatch(/expired/);
  });
});

describe("in-memory bank ledger", () => {
  it("moves money share account → CD funding and tracks deposit status", () => {
    const bank = new BankLedger("CampusUSA");
    bank.openAccount("m1", "Member", 2_500_000n);
    bank.addProduct({
      id: "cd-12mo",
      name: "12-month share certificate",
      termMonths: 12,
      rateBps: 450,
      penaltyBps: 1000,
    });

    const deposit = bank.fundCdDeposit("dep-1", "m1", "cd-12mo", 1_000_000n);
    expect(deposit.status).toBe("funded");
    expect(bank.getAccount("m1").balanceCents).toBe(1_500_000n);
    expect(bank.getAccount(bank.cdFundingAccountId).balanceCents).toBe(1_000_000n);

    bank.markTokenized("dep-1", "abcd");
    expect(bank.getDeposit("dep-1").status).toBe("tokenized");

    bank.closeDeposit("dep-1");
    expect(bank.getDeposit("dep-1").status).toBe("closed");
    expect(bank.getAccount(bank.cdFundingAccountId).balanceCents).toBe(0n);
  });

  it("refuses overdrafts and double funding", () => {
    const bank = new BankLedger("CampusUSA");
    bank.openAccount("m1", "Member", 100n);
    bank.addProduct({
      id: "p",
      name: "p",
      termMonths: 12,
      rateBps: 450,
      penaltyBps: 1000,
    });
    expect(() => bank.fundCdDeposit("d", "m1", "p", 200n)).toThrow(/insufficient/);
    bank.fundCdDeposit("d", "m1", "p", 100n);
    expect(() => bank.fundCdDeposit("d", "m1", "p", 1n)).toThrow(/exists/);
  });
});
