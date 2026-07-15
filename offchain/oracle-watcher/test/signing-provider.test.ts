/**
 * Signing provider selection tests.
 */
import { describe, expect, it } from "vitest";
import {
  EphemeralSigningProvider,
  PemSigningProvider,
  signingProviderFromEnv,
} from "../src/signing-provider.js";
import { generateEd25519KeyPair, privateKeyToPem, verifyUtf8 } from "../src/keys.js";
import { createPublicKey } from "node:crypto";
import { publicKeyFromBase64 } from "../src/keys.js";

describe("SigningProvider", () => {
  it("ephemeral signs and verifies", () => {
    const s = new EphemeralSigningProvider();
    const sig = s.signUtf8Message("hello");
    const pub = publicKeyFromBase64(s.publicKeySpkiBase64());
    expect(verifyUtf8("hello", sig, pub)).toBe(true);
  });

  it("pem provider from env shape", () => {
    const pair = generateEd25519KeyPair();
    const pem = privateKeyToPem(pair.privateKey);
    const s = new PemSigningProvider(pem);
    expect(s.kind).toBe("pem");
    const sig = s.signUtf8Message("ping");
    expect(verifyUtf8("ping", sig, createPublicKey(pair.privateKey))).toBe(true);
  });

  it("signingProviderFromEnv requires key without lab flag", () => {
    expect(() =>
      signingProviderFromEnv({
        ORACLE_SIGNING_PROVIDER: "pem",
      } as NodeJS.ProcessEnv),
    ).toThrow(/ORACLE_SIGNING_KEY_PEM/);
  });

  it("hsm mode requires module ids", () => {
    expect(() =>
      signingProviderFromEnv({
        ORACLE_SIGNING_PROVIDER: "hsm",
      } as NodeJS.ProcessEnv),
    ).toThrow(/ORACLE_HSM_MODULE/);
  });
});
