import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  base58btcDecode,
  base58btcEncode,
  didFromPublicKey,
  didToRawPublicKey,
  generateKeyPair,
  publicKeyFromDid,
  rawPublicKeyBytes,
  signMessage,
  verifyMessage,
} from "../src/index.js";

describe("base58btc", () => {
  it("round-trips random byte strings", () => {
    for (let i = 0; i < 20; i += 1) {
      const bytes = new Uint8Array(randomBytes(1 + (i % 40)));
      expect(base58btcDecode(base58btcEncode(bytes))).toEqual(bytes);
    }
  });

  it("round-trips leading zero bytes", () => {
    const bytes = Uint8Array.from([0, 0, 0, 1, 2, 3]);
    const encoded = base58btcEncode(bytes);
    expect(encoded.startsWith("111")).toBe(true);
    expect(base58btcDecode(encoded)).toEqual(bytes);
  });

  it("handles empty and all-zero inputs", () => {
    expect(base58btcEncode(new Uint8Array(0))).toBe("");
    expect(base58btcDecode("")).toEqual(new Uint8Array(0));
    expect(base58btcDecode(base58btcEncode(new Uint8Array(3)))).toEqual(new Uint8Array(3));
  });

  it("matches a known test vector", () => {
    // "Hello World!" from the draft-msporny-base58 test vectors.
    const bytes = new TextEncoder().encode("Hello World!");
    expect(base58btcEncode(bytes)).toBe("2NEpo7TZRRrLZSi2U");
    expect(base58btcDecode("2NEpo7TZRRrLZSi2U")).toEqual(bytes);
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base58btcDecode("0OIl")).toThrow(/invalid base58btc/);
  });
});

describe("did:key", () => {
  it("round-trips DID encode/decode back to the raw public key", () => {
    const keys = generateKeyPair();
    const did = didFromPublicKey(keys.publicKey);
    expect(did.startsWith("did:key:z")).toBe(true);
    expect(didToRawPublicKey(did)).toEqual(rawPublicKeyBytes(keys.publicKey));

    const reconstructed = publicKeyFromDid(did);
    expect(rawPublicKeyBytes(reconstructed)).toEqual(rawPublicKeyBytes(keys.publicKey));
  });

  it("verifies signatures via the DID-reconstructed key", () => {
    const keys = generateKeyPair();
    const did = didFromPublicKey(keys.publicKey);
    const signature = signMessage("hello cdt", keys.privateKey);
    expect(verifyMessage("hello cdt", signature, did)).toBe(true);
    expect(verifyMessage("hello cdt (tampered)", signature, did)).toBe(false);

    const otherDid = didFromPublicKey(generateKeyPair().publicKey);
    expect(verifyMessage("hello cdt", signature, otherDid)).toBe(false);
  });

  it("rejects malformed DIDs", () => {
    expect(() => didToRawPublicKey("did:web:example.com")).toThrow(/did:key/);
    expect(() => didToRawPublicKey("did:key:abc")).toThrow(/did:key/);
    // Valid base58 but wrong multicodec prefix / length.
    expect(() => didToRawPublicKey(`did:key:z${base58btcEncode(new Uint8Array(10))}`)).toThrow(
      /ed25519/,
    );
  });
});
