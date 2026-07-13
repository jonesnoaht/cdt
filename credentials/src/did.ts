/**
 * Minimal did:key implementation for Ed25519 keys, backed by node:crypto.
 *
 * DID = "did:key:z" + base58btc(0xed 0x01 || raw 32-byte public key)
 * where 0xed 0x01 is the multicodec varint prefix for ed25519-pub and the
 * leading "z" is the multibase prefix for base58btc.
 */

import {
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { base58btcDecode, base58btcEncode } from "./base58.js";

export interface KeyPair {
  publicKey: KeyObject;
  privateKey: KeyObject;
}

const DID_KEY_PREFIX = "did:key:z";

/** Multicodec varint prefix for ed25519-pub. */
const MULTICODEC_ED25519_PUB = Uint8Array.from([0xed, 0x01]);

/** DER SPKI header for an Ed25519 public key; append the raw 32 bytes. */
const ED25519_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

const RAW_PUBLIC_KEY_LENGTH = 32;

/** Generate a fresh Ed25519 keypair. */
export function generateKeyPair(): KeyPair {
  return generateKeyPairSync("ed25519");
}

/** Extract the raw 32-byte Ed25519 public key from a KeyObject. */
export function rawPublicKeyBytes(publicKey: KeyObject): Uint8Array {
  const der = publicKey.export({ format: "der", type: "spki" });
  return new Uint8Array(der.subarray(der.length - RAW_PUBLIC_KEY_LENGTH));
}

/** Derive the did:key DID for an Ed25519 public key. */
export function didFromPublicKey(publicKey: KeyObject): string {
  const raw = rawPublicKeyBytes(publicKey);
  const multicodec = new Uint8Array(MULTICODEC_ED25519_PUB.length + raw.length);
  multicodec.set(MULTICODEC_ED25519_PUB, 0);
  multicodec.set(raw, MULTICODEC_ED25519_PUB.length);
  return DID_KEY_PREFIX + base58btcEncode(multicodec);
}

/** Decode a did:key DID back into the raw 32-byte Ed25519 public key. */
export function didToRawPublicKey(did: string): Uint8Array {
  if (!did.startsWith(DID_KEY_PREFIX)) {
    throw new Error(`not a base58btc did:key DID: ${did}`);
  }
  const multicodec = base58btcDecode(did.slice(DID_KEY_PREFIX.length));
  if (
    multicodec.length !== MULTICODEC_ED25519_PUB.length + RAW_PUBLIC_KEY_LENGTH ||
    multicodec[0] !== MULTICODEC_ED25519_PUB[0] ||
    multicodec[1] !== MULTICODEC_ED25519_PUB[1]
  ) {
    throw new Error(`not an ed25519-pub did:key DID: ${did}`);
  }
  return multicodec.subarray(MULTICODEC_ED25519_PUB.length);
}

/** Reconstruct a node:crypto public KeyObject from a did:key DID. */
export function publicKeyFromDid(did: string): KeyObject {
  const raw = didToRawPublicKey(did);
  const der = new Uint8Array(ED25519_SPKI_PREFIX.length + raw.length);
  der.set(ED25519_SPKI_PREFIX, 0);
  der.set(raw, ED25519_SPKI_PREFIX.length);
  return createPublicKey({ key: Buffer.from(der), format: "der", type: "spki" });
}

/** Sign a UTF-8 message with an Ed25519 private key. */
export function signMessage(message: string, privateKey: KeyObject): Uint8Array {
  return new Uint8Array(cryptoSign(null, Buffer.from(message, "utf8"), privateKey));
}

/** Verify a UTF-8 message signature against the key encoded in a DID. */
export function verifyMessage(
  message: string,
  signature: Uint8Array,
  did: string,
): boolean {
  try {
    return cryptoVerify(
      null,
      Buffer.from(message, "utf8"),
      publicKeyFromDid(did),
      signature,
    );
  } catch {
    return false;
  }
}
