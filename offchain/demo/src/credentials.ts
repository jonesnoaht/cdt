/**
 * Minimal W3C Verifiable Credentials 1.1 mock, vendored for the demo.
 *
 * - did:key-style identifiers: `did:key:z<base58btc(0xed01 || rawPublicKey)>`
 *   so the Ed25519 public key is recoverable from the DID itself.
 * - Signatures: Ed25519 via node:crypto over a canonical (recursively
 *   sorted-key) JSON serialization of the document minus its `proof`.
 * - Trust chain: the NCUA root DID issues an InsuredInstitutionCredential to
 *   the credit union's DID; the credit union issues an
 *   AccountHolderCredential to the member's DID; the member wraps both in a
 *   presentation that they sign as holder.
 *
 * This is a mock: no JSON-LD processing, no revocation lists, no real
 * did:key multibase resolution beyond what is implemented here.
 */

import {
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";

// ---------------------------------------------------------------------------
// base58btc (bitcoin alphabet) — enough for did:key encoding/decoding
// ---------------------------------------------------------------------------

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const byte of bytes) n = (n << 8n) | BigInt(byte);
  let out = "";
  while (n > 0n) {
    out = BASE58_ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = "1" + out;
  }
  return out;
}

export function base58Decode(text: string): Uint8Array {
  let n = 0n;
  for (const char of text) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx < 0) throw new Error(`invalid base58 character: ${char}`);
    n = n * 58n + BigInt(idx);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const char of text) {
    if (char !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

// ---------------------------------------------------------------------------
// DIDs and keys
// ---------------------------------------------------------------------------

/** Multicodec prefix for Ed25519 public keys (0xed, varint-encoded => 0xed 0x01). */
const ED25519_MULTICODEC = Uint8Array.from([0xed, 0x01]);

export interface DidActor {
  did: string;
  publicKey: KeyObject;
  privateKey: KeyObject;
}

/** Extract the 32 raw public key bytes from a node:crypto Ed25519 KeyObject. */
function rawPublicKeyBytes(publicKey: KeyObject): Uint8Array {
  // SPKI DER for Ed25519 is a fixed 12-byte prefix followed by the raw key.
  const spki = publicKey.export({ type: "spki", format: "der" });
  return Uint8Array.from(spki.subarray(spki.length - 32));
}

export function generateDidActor(): DidActor {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { did: didFromPublicKey(publicKey), publicKey, privateKey };
}

export function didFromPublicKey(publicKey: KeyObject): string {
  const raw = rawPublicKeyBytes(publicKey);
  const multicodec = new Uint8Array(ED25519_MULTICODEC.length + raw.length);
  multicodec.set(ED25519_MULTICODEC);
  multicodec.set(raw, ED25519_MULTICODEC.length);
  return `did:key:z${base58Encode(multicodec)}`;
}

/** Resolve a did:key back to its Ed25519 public key. */
export function publicKeyFromDid(did: string): KeyObject {
  const match = /^did:key:z([1-9A-HJ-NP-Za-km-z]+)$/.exec(did);
  if (!match || !match[1]) throw new Error(`unresolvable DID: ${did}`);
  const decoded = base58Decode(match[1]);
  if (
    decoded.length !== 34 ||
    decoded[0] !== ED25519_MULTICODEC[0] ||
    decoded[1] !== ED25519_MULTICODEC[1]
  ) {
    throw new Error(`not an Ed25519 did:key: ${did}`);
  }
  const raw = decoded.subarray(2);
  // Rebuild the SPKI DER document around the raw key.
  const prefix = Uint8Array.from([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
  ]);
  const der = Buffer.concat([prefix, raw]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

// ---------------------------------------------------------------------------
// Canonical JSON + signatures
// ---------------------------------------------------------------------------

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Recursively sort object keys, then JSON.stringify — a poor man's JCS. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value as Json));
}

function sortKeysDeep(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const sorted: { [key: string]: Json } = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep(value[key] as Json);
    }
    return sorted;
  }
  return value;
}

export interface Proof {
  type: "Ed25519Signature2020";
  created: string;
  verificationMethod: string;
  proofPurpose: string;
  proofValue: string;
}

function makeProof(
  document: Record<string, unknown>,
  signer: DidActor,
  proofPurpose: string,
  now: Date,
): Proof {
  const payload = Buffer.from(canonicalize(document), "utf8");
  const signature = edSign(null, payload, signer.privateKey);
  return {
    type: "Ed25519Signature2020",
    created: now.toISOString(),
    verificationMethod: `${signer.did}#key-1`,
    proofPurpose,
    proofValue: `z${base58Encode(Uint8Array.from(signature))}`,
  };
}

function verifyProof(
  document: Record<string, unknown>,
  proof: Proof,
): boolean {
  try {
    const did = proof.verificationMethod.split("#")[0]!;
    const publicKey = publicKeyFromDid(did);
    const payload = Buffer.from(canonicalize(document), "utf8");
    if (!proof.proofValue.startsWith("z")) return false;
    const signature = base58Decode(proof.proofValue.slice(1));
    return edVerify(null, payload, publicKey, signature);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export interface VerifiableCredential {
  "@context": string[];
  id: string;
  type: string[];
  issuer: string;
  issuanceDate: string;
  expirationDate: string;
  credentialSubject: { id: string } & Record<string, Json>;
  proof: Proof;
}

export interface VerifiablePresentation {
  "@context": string[];
  type: string[];
  holder: string;
  verifiableCredential: VerifiableCredential[];
  proof: Proof;
}

const VC_CONTEXT = "https://www.w3.org/2018/credentials/v1";

export interface IssueOptions {
  /** Credential id; defaults to a urn:uuid. */
  id?: string;
  now?: Date;
  /** Validity period in milliseconds (default: 365 days). */
  validForMs?: number;
}

export function issueCredential(
  issuer: DidActor,
  credentialType: string,
  credentialSubject: { id: string } & Record<string, Json>,
  options: IssueOptions = {},
): VerifiableCredential {
  const now = options.now ?? new Date();
  const validForMs = options.validForMs ?? 365 * 24 * 60 * 60 * 1000;
  const unsigned = {
    "@context": [VC_CONTEXT],
    id: options.id ?? `urn:uuid:${crypto.randomUUID()}`,
    type: ["VerifiableCredential", credentialType],
    issuer: issuer.did,
    issuanceDate: now.toISOString(),
    expirationDate: new Date(now.getTime() + validForMs).toISOString(),
    credentialSubject,
  };
  return { ...unsigned, proof: makeProof(unsigned, issuer, "assertionMethod", now) };
}

export function verifyCredential(vc: VerifiableCredential, now = new Date()): {
  ok: boolean;
  reason?: string;
} {
  const { proof, ...unsigned } = vc;
  if (!proof.verificationMethod.startsWith(vc.issuer)) {
    return { ok: false, reason: "proof key does not belong to issuer" };
  }
  if (!verifyProof(unsigned, proof)) {
    return { ok: false, reason: "invalid issuer signature" };
  }
  if (new Date(vc.expirationDate).getTime() <= now.getTime()) {
    return { ok: false, reason: "credential expired" };
  }
  return { ok: true };
}

export function createPresentation(
  holder: DidActor,
  credentials: VerifiableCredential[],
  now = new Date(),
): VerifiablePresentation {
  const unsigned = {
    "@context": [VC_CONTEXT],
    type: ["VerifiablePresentation"],
    holder: holder.did,
    verifiableCredential: credentials,
  };
  return {
    ...unsigned,
    proof: makeProof(unsigned, holder, "authentication", now),
  };
}

export interface PresentationPolicy {
  /** DID of the trusted root of the chain (e.g. NCUA). */
  trustedRoot: string;
  /** Credential type the root must have issued to the institution. */
  institutionCredentialType: string;
  /** Credential type the institution must have issued to the holder. */
  holderCredentialType: string;
}

/**
 * Verify a two-link presentation:
 *
 *   trustedRoot --institutionCredential--> institution
 *   institution --holderCredential-------> presentation.holder
 *
 * Checks both credential signatures, the issuer chain, expiry, and the
 * holder's signature over the presentation itself.
 */
export function verifyPresentation(
  presentation: VerifiablePresentation,
  policy: PresentationPolicy,
  now = new Date(),
): { ok: boolean; reason?: string } {
  const { proof, ...unsignedPresentation } = presentation;
  if (!proof.verificationMethod.startsWith(presentation.holder)) {
    return { ok: false, reason: "presentation proof key is not the holder's" };
  }
  if (!verifyProof(unsignedPresentation, proof)) {
    return { ok: false, reason: "invalid holder signature on presentation" };
  }

  const institutionVc = presentation.verifiableCredential.find((vc) =>
    vc.type.includes(policy.institutionCredentialType),
  );
  if (!institutionVc) {
    return { ok: false, reason: `missing ${policy.institutionCredentialType}` };
  }
  const holderVc = presentation.verifiableCredential.find((vc) =>
    vc.type.includes(policy.holderCredentialType),
  );
  if (!holderVc) {
    return { ok: false, reason: `missing ${policy.holderCredentialType}` };
  }

  const institutionCheck = verifyCredential(institutionVc, now);
  if (!institutionCheck.ok) {
    return {
      ok: false,
      reason: `${policy.institutionCredentialType}: ${institutionCheck.reason}`,
    };
  }
  const holderCheck = verifyCredential(holderVc, now);
  if (!holderCheck.ok) {
    return {
      ok: false,
      reason: `${policy.holderCredentialType}: ${holderCheck.reason}`,
    };
  }

  // Chain of trust.
  if (institutionVc.issuer !== policy.trustedRoot) {
    return {
      ok: false,
      reason: "institution credential not issued by trusted root",
    };
  }
  if (holderVc.issuer !== institutionVc.credentialSubject.id) {
    return {
      ok: false,
      reason: "holder credential not issued by the accredited institution",
    };
  }
  if (holderVc.credentialSubject.id !== presentation.holder) {
    return {
      ok: false,
      reason: "holder credential subject is not the presentation holder",
    };
  }
  return { ok: true };
}
