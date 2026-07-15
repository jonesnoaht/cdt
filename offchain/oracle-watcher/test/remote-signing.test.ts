/**
 * RemoteSigningProvider unit tests (mock fetch).
 */
import { describe, expect, it } from "vitest";
import { createPublicKey } from "node:crypto";
import {
  RemoteSigningProvider,
  signingProviderFromEnv,
} from "../src/signing-provider.js";
import {
  generateEd25519KeyPair,
  publicKeyToBase64,
  signUtf8,
  verifyUtf8,
} from "../src/keys.js";

describe("RemoteSigningProvider", () => {
  it("signs via HTTP and pins public key", async () => {
    const pair = generateEd25519KeyPair();
    const pub = publicKeyToBase64(pair.publicKey);
    const provider = new RemoteSigningProvider({
      url: "http://signer.local/sign",
      publicKeySpkiBase64: pub,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { message: string };
        return new Response(
          JSON.stringify({
            signature: signUtf8(body.message, pair.privateKey),
            publicKeySpkiBase64: pub,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    expect(provider.publicKeySpkiBase64()).toBe(pub);
    const sig = await provider.signUtf8Message("hello-remote");
    expect(verifyUtf8("hello-remote", sig, createPublicKey(pair.privateKey))).toBe(
      true,
    );
  });

  it("rejects public key mismatch vs pin", async () => {
    const a = generateEd25519KeyPair();
    const b = generateEd25519KeyPair();
    const provider = new RemoteSigningProvider({
      url: "http://signer.local/sign",
      publicKeySpkiBase64: publicKeyToBase64(a.publicKey),
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            signature: signUtf8("x", b.privateKey),
            publicKeySpkiBase64: publicKeyToBase64(b.publicKey),
          }),
          { status: 200 },
        ),
    });
    await expect(provider.signUtf8Message("x")).rejects.toThrow(/pin/i);
  });

  it("fromEnv remote requires url", () => {
    expect(() =>
      signingProviderFromEnv({
        ORACLE_SIGNING_PROVIDER: "remote",
      } as NodeJS.ProcessEnv),
    ).toThrow(/ORACLE_REMOTE_SIGNER_URL/);
  });
});
