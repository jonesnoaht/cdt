/**
 * Vendored mock W3C Verifiable Credentials (VC Data Model 1.1) verifier.
 *
 * This is a deliberately small, self-contained stand-in for a real VC stack:
 *  - Ed25519 signatures via node:crypto
 *  - deterministic JSON canonicalization (sorted keys) instead of URDNA2015
 *  - a two-link issuer chain: NCUA (trusted root) -> credit union -> member
 *  - expiration checks on every credential and holder-binding on the
 *    presentation proof.
 *
 * A sibling unit owns the real credentials package; the oracle watcher only
 * depends on the pluggable `VerifyPresentationHook` shape, so this module can
 * be swapped out without touching the watcher.
 */
import { type KeyObject } from 'node:crypto';
import { canonicalize } from './canonicalize.js';
import type { VerifyPresentationResult } from './watcher.js';
import {
  generateEd25519KeyPair,
  publicKeyFromBase64,
  publicKeyToBase64,
  signUtf8,
  verifyUtf8,
} from './keys.js';

export const VC_CONTEXT = 'https://www.w3.org/2018/credentials/v1';

export interface MockProof {
  type: 'Ed25519Signature2020';
  created: string;
  verificationMethod: string; // DID of the signer
  proofValue: string; // base64 Ed25519 signature over the canonicalized document sans proof
}

export interface MockCredential {
  '@context': string[];
  type: string[];
  issuer: string;
  issuanceDate: string;
  expirationDate: string;
  credentialSubject: { id: string; role: 'credit-union' | 'member'; publicKeyBase64: string };
  proof?: MockProof;
}

export interface MockPresentation {
  '@context': string[];
  type: string[];
  holder: string;
  verifiableCredential: MockCredential[];
  proof?: MockProof;
}

export interface MockIdentity {
  did: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicKeyBase64: string;
}

/** Same shape as the watcher's pluggable-hook result (single source of truth). */
export type VerifyResult = VerifyPresentationResult;

export function createIdentity(did: string): MockIdentity {
  const { privateKey, publicKey } = generateEd25519KeyPair();
  return { did, privateKey, publicKey, publicKeyBase64: publicKeyToBase64(publicKey) };
}

function makeProof(doc: object, signer: MockIdentity): MockProof {
  return {
    type: 'Ed25519Signature2020',
    created: new Date().toISOString(),
    verificationMethod: signer.did,
    proofValue: signUtf8(canonicalize({ ...doc, proof: undefined }), signer.privateKey),
  };
}

function proofIsValid(doc: { proof?: MockProof }, signerPublicKeyB64: string): boolean {
  const { proof, ...rest } = doc;
  if (!proof || proof.type !== 'Ed25519Signature2020') return false;
  try {
    return verifyUtf8(canonicalize(rest), proof.proofValue, publicKeyFromBase64(signerPublicKeyB64));
  } catch {
    return false;
  }
}

/** Issue a credential from `issuer` binding `subject`'s DID, role, and public key. */
export function issueCredential(
  issuer: MockIdentity,
  subject: { did: string; role: 'credit-union' | 'member'; publicKeyBase64: string },
  opts: { expiresInMs?: number; issuedAt?: number } = {},
): MockCredential {
  const issuedAt = opts.issuedAt ?? Date.now();
  const credential: MockCredential = {
    '@context': [VC_CONTEXT],
    type: ['VerifiableCredential', subject.role === 'member' ? 'MemberCredential' : 'CreditUnionCharterCredential'],
    issuer: issuer.did,
    issuanceDate: new Date(issuedAt).toISOString(),
    expirationDate: new Date(issuedAt + (opts.expiresInMs ?? 365 * 24 * 3600 * 1000)).toISOString(),
    credentialSubject: { id: subject.did, role: subject.role, publicKeyBase64: subject.publicKeyBase64 },
  };
  credential.proof = makeProof(credential, issuer);
  return credential;
}

/** Wrap credentials in a presentation signed by the holder (the member). */
export function createPresentation(holder: MockIdentity, credentials: MockCredential[]): MockPresentation {
  const presentation: MockPresentation = {
    '@context': [VC_CONTEXT],
    type: ['VerifiablePresentation'],
    holder: holder.did,
    verifiableCredential: credentials,
  };
  presentation.proof = makeProof(presentation, holder);
  return presentation;
}

/** Parse an ISO instant; returns null for missing/malformed values (fail closed, never NaN). */
function parseInstant(value: string | undefined): number | null {
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/** Not-before / expiry validation. Missing or unparseable dates are rejected. */
function credentialTimeError(cred: MockCredential, now: number, label: string): string | null {
  const issued = parseInstant(cred.issuanceDate);
  if (issued === null) return `${label} credential has a missing or malformed issuanceDate`;
  if (issued > now) return `${label} credential is not yet valid (future issuanceDate)`;
  const expires = parseInstant(cred.expirationDate);
  if (expires === null) return `${label} credential has a missing or malformed expirationDate`;
  if (expires <= now) return `${label} credential expired`;
  return null;
}

/** Select exactly one credential for a role; ambiguity (0 or >1 matches) is rejected. */
function selectCredential(creds: MockCredential[], role: 'credit-union' | 'member'): MockCredential | null {
  const matches = creds.filter(
    (c) => c.credentialSubject?.role === role && c.type?.includes('VerifiableCredential'),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/**
 * Verify a presentation against the trusted NCUA root:
 * root signs the credit-union credential, the credit union signs the member
 * credential, and the member (expected holder) signs the presentation itself.
 *
 * Mock-scope limitation (documented, not enforced): there is no
 * challenge/nonce binding, so a captured presentation is replayable while
 * the member credential remains valid. A production verifier must bind a
 * per-request challenge and domain into the presentation proof.
 */
export function verifyPresentation(
  presentation: MockPresentation,
  opts: { trustedRootDid: string; trustedRootPublicKeyBase64: string; expectedHolderDid: string; now?: number },
): VerifyResult {
  const now = opts.now ?? Date.now();
  const fail = (error: string): VerifyResult => ({ verified: false, error });
  if (!presentation.type?.includes('VerifiablePresentation')) return fail('not a VerifiablePresentation');
  if (presentation.holder !== opts.expectedHolderDid) {
    return fail(`holder ${presentation.holder} does not match expected DID ${opts.expectedHolderDid}`);
  }
  const creds = presentation.verifiableCredential ?? [];
  const cuCred = selectCredential(creds, 'credit-union');
  const memberCred = selectCredential(creds, 'member');
  if (!cuCred) return fail('expected exactly one credit-union credential');
  if (!memberCred) return fail('expected exactly one member credential');
  // Link 1: NCUA root -> credit union
  if (cuCred.issuer !== opts.trustedRootDid) return fail(`credit-union credential issuer ${cuCred.issuer} is not the trusted root`);
  if (!proofIsValid(cuCred, opts.trustedRootPublicKeyBase64)) return fail('credit-union credential signature invalid');
  const cuTimeError = credentialTimeError(cuCred, now, 'credit-union');
  if (cuTimeError) return fail(cuTimeError);
  // Link 2: credit union -> member
  if (memberCred.issuer !== cuCred.credentialSubject.id) return fail('member credential not issued by the accredited credit union');
  if (!proofIsValid(memberCred, cuCred.credentialSubject.publicKeyBase64)) return fail('member credential signature invalid');
  const memberTimeError = credentialTimeError(memberCred, now, 'member');
  if (memberTimeError) return fail(memberTimeError);
  if (memberCred.credentialSubject.id !== opts.expectedHolderDid) return fail('member credential subject does not match holder');
  // Holder binding: the member signed the presentation with the key attested in their credential.
  if (!proofIsValid(presentation, memberCred.credentialSubject.publicKeyBase64)) return fail('presentation proof invalid');
  return { verified: true };
}
