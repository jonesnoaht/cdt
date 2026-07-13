/**
 * Fast unit tests for the vendored mocks: interest math (mirrors the Aiken
 * lib), the W3C VC mock, and the in-memory bank ledger.
 */

import { describe, expect, it } from "vitest";

import { BankLedger } from "../src/bank.js";
import {
  createPresentation,
  generateDidActor,
  issueCredential,
  publicKeyFromDid,
  verifyCredential,
  verifyPresentation,
} from "../src/credentials.js";
import {
  accrued,
  earlyPayout,
  fullInterest,
  maturePayout,
  penaltyFee,
  YEAR_MS,
  type CdTerms,
} from "../src/interest.js";

describe("interest math (mirrors lib/cdt/interest.ak)", () => {
  const terms: CdTerms = {
    principal: 10_000_000_000n,
    rateBps: 450n,
    start: 0n,
    maturity: YEAR_MS,
    penaltyBps: 1_000n,
  };

  it("computes one year of full interest", () => {
    expect(fullInterest(terms)).toBe(450_000_000n);
    expect(maturePayout(terms)).toBe(10_450_000_000n);
  });

  it("clamps accrual to the term", () => {
    expect(accrued(terms, -5n)).toBe(0n);
    expect(accrued(terms, YEAR_MS * 2n)).toBe(fullInterest(terms));
  });

  it("floors the 120-second demo term the same way the validator does", () => {
    const short: CdTerms = { ...terms, maturity: 120_000n };
    // 10^10 * 450 * 120_000 / (10^4 * 31_557_600_000) = 1711.15… -> 1711
    expect(fullInterest(short)).toBe(1_711n);
  });

  it("applies the early-withdrawal penalty to accrued interest only", () => {
    const t = YEAR_MS / 2n;
    expect(accrued(terms, t)).toBe(225_000_000n);
    expect(penaltyFee(accrued(terms, t), terms.penaltyBps)).toBe(22_500_000n);
    expect(earlyPayout(terms, t)).toBe(10_000_000_000n + 202_500_000n);
  });
});

describe("verifiable credentials mock", () => {
  it("issues, presents, and verifies the NCUA → CU → member chain", () => {
    const ncua = generateDidActor();
    const cu = generateDidActor();
    const member = generateDidActor();

    const institutionVc = issueCredential(ncua, "InsuredInstitutionCredential", {
      id: cu.did,
    });
    const holderVc = issueCredential(cu, "AccountHolderCredential", {
      id: member.did,
    });
    expect(verifyCredential(institutionVc).ok).toBe(true);
    expect(verifyCredential(holderVc).ok).toBe(true);

    const presentation = createPresentation(member, [institutionVc, holderVc]);
    const result = verifyPresentation(presentation, {
      trustedRoot: ncua.did,
      institutionCredentialType: "InsuredInstitutionCredential",
      holderCredentialType: "AccountHolderCredential",
    });
    expect(result).toEqual({ ok: true });
  });

  it("round-trips public keys through did:key", () => {
    const actor = generateDidActor();
    const resolved = publicKeyFromDid(actor.did);
    expect(resolved.equals(actor.publicKey)).toBe(true);
  });

  it("rejects tampered credentials and untrusted roots", () => {
    const ncua = generateDidActor();
    const rogue = generateDidActor();
    const cu = generateDidActor();
    const member = generateDidActor();

    const institutionVc = issueCredential(ncua, "InsuredInstitutionCredential", {
      id: cu.did,
    });
    const holderVc = issueCredential(cu, "AccountHolderCredential", {
      id: member.did,
    });

    // Tampering breaks the signature.
    const tampered = {
      ...holderVc,
      credentialSubject: { id: member.did, kycLevel: "forged" },
    };
    expect(verifyCredential(tampered).ok).toBe(false);

    // A chain rooted somewhere else is refused.
    const rogueInstitutionVc = issueCredential(rogue, "InsuredInstitutionCredential", {
      id: cu.did,
    });
    const presentation = createPresentation(member, [rogueInstitutionVc, holderVc]);
    const result = verifyPresentation(presentation, {
      trustedRoot: ncua.did,
      institutionCredentialType: "InsuredInstitutionCredential",
      holderCredentialType: "AccountHolderCredential",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/trusted root/);
  });

  it("rejects expired credentials", () => {
    const ncua = generateDidActor();
    const cu = generateDidActor();
    const vc = issueCredential(
      ncua,
      "InsuredInstitutionCredential",
      { id: cu.did },
      { validForMs: 1000 },
    );
    expect(verifyCredential(vc, new Date(Date.now() + 5000)).ok).toBe(false);
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
