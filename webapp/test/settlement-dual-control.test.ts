/**
 * SettlementAuth dual-control cosign tests.
 */
import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { SettlementSigner } from "../src/server/settlement-auth.js";

function pemPair(): { privatePem: string; publicSpki: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicSpki: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

describe("SettlementAuth dual control", () => {
  const primary = pemPair();
  const secondary = pemPair();
  const now = Date.parse("2030-01-01T00:00:00.000Z");

  it("single-key issue verifies without dual control", () => {
    const signer = new SettlementSigner({ privateKeyPem: primary.privatePem });
    const auth = signer.issue({
      presentmentId: "1",
      depositId: "dep-1",
      redeemerInstitutionId: "cu_gulfside",
      cashOutCents: 100_00,
      cashOutMode: "mature",
      nowMs: now,
    });
    expect(auth.secondarySignature).toBeUndefined();
    expect(signer.verify(auth, now).ok).toBe(true);
  });

  it("dual control issues both signatures and verifies", () => {
    const signer = new SettlementSigner({
      privateKeyPem: primary.privatePem,
      secondaryPrivateKeyPem: secondary.privatePem,
      dualControlRequired: true,
    });
    const auth = signer.issue({
      presentmentId: "2",
      depositId: "dep-2",
      redeemerInstitutionId: "cu_gulfside",
      cashOutCents: 250_00,
      cashOutMode: "early",
      nowMs: now,
    });
    expect(auth.secondarySignature).toBeTruthy();
    expect(auth.secondaryPublicKeySpkiBase64).toBe(secondary.publicSpki);
    expect(signer.verify(auth, now).ok).toBe(true);
  });

  it("rejects missing secondary when dual control required", () => {
    const dual = new SettlementSigner({
      privateKeyPem: primary.privatePem,
      secondaryPrivateKeyPem: secondary.privatePem,
      dualControlRequired: true,
    });
    const single = new SettlementSigner({ privateKeyPem: primary.privatePem });
    const auth = single.issue({
      presentmentId: "3",
      depositId: "dep-3",
      redeemerInstitutionId: "cu_gulfside",
      cashOutCents: 1,
      cashOutMode: "mature",
      nowMs: now,
    });
    // re-pin primary key match for dual verifier
    const verifyOnly = new SettlementSigner({
      privateKeyPem: primary.privatePem,
      secondaryPublicKeySpkiBase64: secondary.publicSpki,
      dualControlRequired: true,
    });
    const r = verifyOnly.verify(auth, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/secondary/i);
    void dual;
  });

  it("rejects wrong secondary cosign", () => {
    const other = pemPair();
    const signer = new SettlementSigner({
      privateKeyPem: primary.privatePem,
      secondaryPrivateKeyPem: secondary.privatePem,
    });
    const auth = signer.issue({
      presentmentId: "4",
      depositId: "dep-4",
      redeemerInstitutionId: "cu_gulfside",
      cashOutCents: 1,
      cashOutMode: "mature",
      nowMs: now,
    });
    auth.secondaryPublicKeySpkiBase64 = other.publicSpki;
    const r = signer.verify(auth, now);
    expect(r.ok).toBe(false);
  });

  it("throws on dual issue without secondary private key", () => {
    const signer = new SettlementSigner({
      privateKeyPem: primary.privatePem,
      dualControlRequired: true,
      secondaryPublicKeySpkiBase64: secondary.publicSpki,
    });
    expect(() =>
      signer.issue({
        presentmentId: "5",
        depositId: "dep-5",
        redeemerInstitutionId: "cu_gulfside",
        cashOutCents: 1,
        cashOutMode: "mature",
        nowMs: now,
      }),
    ).toThrow(/secondary/i);
  });
});
