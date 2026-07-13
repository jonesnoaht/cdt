/**
 * Mock W3C Verifiable Credentials Data Model 1.1 implementation.
 *
 * Credentials and presentations are plain JSON documents carrying a mock
 * Ed25519Signature2020-style proof: the document (minus `proof`) plus the
 * proof options (minus `proofValue`) are canonicalized with a deterministic
 * JSON stringify and signed with the controller's Ed25519 key. Signatures are
 * base58btc-encoded in `proofValue`.
 *
 * Trust chain verified by `verifyPresentation`:
 *
 *   trusted root (NCUA) --InsuredInstitutionCredential--> credit union DID
 *   credit union        --AccountHolderCredential-------> member DID (holder)
 */

import { base58btcDecode, base58btcEncode } from "./base58.js";
import { canonicalize } from "./canonicalize.js";
import {
  didFromPublicKey,
  generateKeyPair,
  signMessage,
  verifyMessage,
  type KeyPair,
} from "./did.js";

export const VC_CONTEXT = "https://www.w3.org/2018/credentials/v1";
export const PROOF_TYPE = "Ed25519Signature2020";
export const INSURED_INSTITUTION_CREDENTIAL = "InsuredInstitutionCredential";
export const ACCOUNT_HOLDER_CREDENTIAL = "AccountHolderCredential";

export interface Proof {
  type: typeof PROOF_TYPE;
  created: string;
  verificationMethod: string;
  proofPurpose: "assertionMethod" | "authentication";
  /** Present on presentation proofs; binds the proof to a verifier nonce. */
  challenge?: string;
  /** base58btc-encoded Ed25519 signature. */
  proofValue: string;
}

export interface CredentialSubject {
  id: string;
  [claim: string]: unknown;
}

export interface VerifiableCredential {
  "@context": string[];
  type: string[];
  issuer: string;
  issuanceDate: string;
  expirationDate?: string;
  credentialSubject: CredentialSubject;
  proof: Proof;
}

export interface VerifiablePresentation {
  "@context": string[];
  type: string[];
  holder: string;
  verifiableCredential: VerifiableCredential[];
  proof: Proof;
}

export interface Issuer {
  name: string;
  did: string;
  keys: KeyPair;
}

export interface Holder {
  did: string;
  keys: KeyPair;
}

export interface IssueOptions {
  /** Credential lifetime; omit for a credential that never expires. */
  expiresInMs?: number;
}

export interface PresentationOptions {
  /** Verifier-supplied nonce, echoed into the presentation proof. */
  challenge: string;
}

export interface VerifyOptions {
  /** DIDs of trusted root issuers (e.g. the NCUA). */
  trustedRoots: string[];
  /** The nonce the verifier handed to the holder for this presentation. */
  challenge: string;
  /** Verification time; defaults to the current time. */
  now?: Date;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/** Create a named issuer with a fresh Ed25519 keypair and did:key DID. */
export function createIssuer(name: string): Issuer {
  const keys = generateKeyPair();
  return { name, did: didFromPublicKey(keys.publicKey), keys };
}

/** Create a credential holder with a fresh Ed25519 keypair and did:key DID. */
export function createHolder(): Holder {
  const keys = generateKeyPair();
  return { did: didFromPublicKey(keys.publicKey), keys };
}

/**
 * The string that gets signed: the document without its `proof`, combined
 * with the proof options without `proofValue`, canonicalized. Including the
 * proof options means the challenge (and verification method) are covered by
 * the signature, so neither can be swapped after the fact.
 */
function signingPayload(
  document: { proof?: unknown },
  proofOptions: Omit<Proof, "proofValue">,
): string {
  const { proof: _ignored, ...unsigned } = document;
  return canonicalize({ document: unsigned, proof: proofOptions });
}

function createProof(
  document: Record<string, unknown>,
  signer: { did: string; keys: KeyPair },
  proofPurpose: Proof["proofPurpose"],
  challenge?: string,
): Proof {
  const options: Omit<Proof, "proofValue"> = {
    type: PROOF_TYPE,
    created: new Date().toISOString(),
    verificationMethod: signer.did,
    proofPurpose,
    ...(challenge === undefined ? {} : { challenge }),
  };
  const signature = signMessage(
    signingPayload(document, options),
    signer.keys.privateKey,
  );
  return { ...options, proofValue: base58btcEncode(signature) };
}

/**
 * Verify a document's proof signature against the DID named in
 * `proof.verificationMethod`. Returns false (never throws) on malformed
 * proofs, unknown DIDs, or bad signatures.
 */
function verifyProofSignature(document: { proof: Proof }): boolean {
  const { proof } = document;
  if (proof?.type !== PROOF_TYPE || typeof proof.proofValue !== "string") {
    return false;
  }
  const { proofValue, ...options } = proof;
  try {
    return verifyMessage(
      signingPayload(document, options),
      base58btcDecode(proofValue),
      proof.verificationMethod,
    );
  } catch {
    return false;
  }
}

/** Issue a signed credential of `type` about `subjectDid`. */
export function issueCredential(
  issuer: Issuer,
  subjectDid: string,
  type: string,
  claims: Record<string, unknown>,
  options: IssueOptions = {},
): VerifiableCredential {
  const now = new Date();
  const unsigned = {
    "@context": [VC_CONTEXT],
    type: ["VerifiableCredential", type],
    issuer: issuer.did,
    issuanceDate: now.toISOString(),
    ...(options.expiresInMs === undefined
      ? {}
      : { expirationDate: new Date(now.getTime() + options.expiresInMs).toISOString() }),
    credentialSubject: { id: subjectDid, ...claims },
  };
  return {
    ...unsigned,
    proof: createProof(unsigned, issuer, "assertionMethod"),
  };
}

/** Wrap credentials in a presentation signed by the holder. */
export function createPresentation(
  holder: Holder,
  credentials: VerifiableCredential[],
  options: PresentationOptions,
): VerifiablePresentation {
  if (typeof options.challenge !== "string" || options.challenge.length === 0) {
    throw new Error("a non-empty challenge is required to create a presentation");
  }
  const unsigned = {
    "@context": [VC_CONTEXT],
    type: ["VerifiablePresentation"],
    holder: holder.did,
    verifiableCredential: credentials,
  };
  return {
    ...unsigned,
    proof: createProof(unsigned, holder, "authentication", options.challenge),
  };
}

function fail(reason: string): VerifyResult {
  return { ok: false, reason };
}

/**
 * Verify a presentation end to end:
 *
 * 1. The presentation proof is signed by the stated holder and echoes the
 *    verifier's challenge.
 * 2. Every embedded credential has a valid signature from its stated issuer
 *    and is within its validity window.
 * 3. Every credential's issuer is either a trusted root or the subject of a
 *    valid InsuredInstitutionCredential issued by a trusted root within the
 *    same presentation (the NCUA -> credit union -> member chain).
 * 4. Every credential is bound to the holder: its subject is the holder,
 *    except chain credentials whose subject is another credential's issuer.
 */
export function verifyPresentation(
  presentation: VerifiablePresentation,
  options: VerifyOptions,
): VerifyResult {
  const now = options.now ?? new Date();
  const trustedRoots = new Set(options.trustedRoots);

  if (!presentation?.type?.includes("VerifiablePresentation")) {
    return fail("document is not a VerifiablePresentation");
  }
  const { proof, holder } = presentation;
  if (!proof) {
    return fail("presentation has no proof");
  }
  if (typeof holder !== "string" || holder.length === 0) {
    return fail("presentation has no holder");
  }
  // Require a real challenge at runtime: without this, a plain-JS caller
  // omitting `challenge` would match a challenge-less proof (undefined ===
  // undefined) and silently lose replay protection.
  if (typeof options.challenge !== "string" || options.challenge.length === 0) {
    return fail("a non-empty expected challenge is required to verify a presentation");
  }
  if (proof.challenge !== options.challenge) {
    return fail("presentation challenge does not match the expected challenge");
  }
  if (proof.proofPurpose !== "authentication") {
    return fail("presentation proof purpose must be authentication");
  }
  if (proof.verificationMethod !== holder) {
    return fail("presentation proof was not created by the stated holder");
  }
  if (!verifyProofSignature(presentation)) {
    return fail("presentation signature is invalid");
  }

  const credentials = presentation.verifiableCredential;
  if (!Array.isArray(credentials) || credentials.length === 0) {
    return fail("presentation contains no credentials");
  }

  for (const credential of credentials) {
    const label = credentialLabel(credential);
    if (!credential.type?.includes("VerifiableCredential")) {
      return fail(`${label} is not a VerifiableCredential`);
    }
    if (credential.proof?.verificationMethod !== credential.issuer) {
      return fail(`${label} proof was not created by its stated issuer`);
    }
    if (credential.proof.proofPurpose !== "assertionMethod") {
      return fail(`${label} proof purpose must be assertionMethod`);
    }
    if (!verifyProofSignature(credential)) {
      return fail(`${label} signature is invalid (credential may have been tampered with)`);
    }
    if (Number.isNaN(Date.parse(credential.issuanceDate))) {
      return fail(`${label} has an invalid issuanceDate`);
    }
    if (new Date(credential.issuanceDate).getTime() > now.getTime()) {
      return fail(`${label} is not yet valid`);
    }
    if (credential.expirationDate !== undefined) {
      const expires = Date.parse(credential.expirationDate);
      if (Number.isNaN(expires)) {
        return fail(`${label} has an invalid expirationDate`);
      }
      if (expires <= now.getTime()) {
        return fail(`${label} has expired`);
      }
    }
  }

  // Subjects attested as insured institutions by a trusted root. Signatures
  // and validity windows were already checked above.
  const attestedInstitutions = new Set(
    credentials
      .filter(
        (credential) =>
          credential.type.includes(INSURED_INSTITUTION_CREDENTIAL) &&
          trustedRoots.has(credential.issuer),
      )
      .map((credential) => credential.credentialSubject.id),
  );

  for (const credential of credentials) {
    if (trustedRoots.has(credential.issuer)) {
      continue;
    }
    if (!attestedInstitutions.has(credential.issuer)) {
      return fail(
        `${credentialLabel(credential)} issuer ${credential.issuer} is not a trusted root ` +
          "and holds no valid InsuredInstitutionCredential from a trusted root",
      );
    }
  }

  for (const credential of credentials) {
    const subject = credential.credentialSubject.id;
    if (subject === holder) {
      continue;
    }
    // Chain credentials attest ANOTHER credential's issuer, not the holder.
    // `other !== credential` blocks a self-referential institution credential
    // (subject === its own issuer) from exempting itself.
    const isChainCredential =
      credential.type.includes(INSURED_INSTITUTION_CREDENTIAL) &&
      credentials.some((other) => other !== credential && other.issuer === subject);
    if (!isChainCredential) {
      return fail(
        `${credentialLabel(credential)} subject ${subject} does not match the presentation holder`,
      );
    }
  }

  // A presentation made only of chain credentials proves nothing about the
  // holder; at least one credential must be about the holder themselves.
  if (!credentials.some((credential) => credential.credentialSubject.id === holder)) {
    return fail("presentation contains no credential about the holder");
  }

  return { ok: true };
}

function credentialLabel(credential: VerifiableCredential): string {
  const specific = credential.type?.find((t) => t !== "VerifiableCredential");
  return specific ?? "credential";
}
