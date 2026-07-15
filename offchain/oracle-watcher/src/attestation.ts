import { createHash, type KeyObject } from 'node:crypto';
import { canonicalize } from './canonicalize.js';
import { publicKeyFromBase64, publicKeyToBase64, signUtf8, verifyUtf8 } from './keys.js';

/**
 * Average Gregorian month in milliseconds (365.2425 days / 12), used to turn
 * `term_months` into a maturity timestamp.
 */
export const MS_PER_MONTH = 2_629_800_000;

/**
 * DEMO CONVERSION — cents to lovelace.
 *
 * For this demo we peg 1 USD = 1 ADA, so 100 cents = 1_000_000 lovelace,
 * i.e. 1 cent = 10_000 lovelace. A production oracle would consult a price
 * feed (or mint a stable-denominated asset) instead of a fixed peg.
 */
export const LOVELACE_PER_CENT = 10_000n;

/** Schema id for account-bound deposit attestations. */
export const ATTESTATION_SCHEMA = 'cdt.attestation.v2' as const;

export function centsToLovelace(amountCents: bigint): bigint {
  return amountCents * LOVELACE_PER_CENT;
}

/**
 * The payload the oracle signs. Every field is covered by the signature and
 * by `attestationHash(payload)`. The mint vault datum carries
 * `attestation_hash` so any third party can recompute the hash from a
 * published attestation and prove the CDT is bound to this deposit+account.
 */
export interface AttestationPayload {
  schema: typeof ATTESTATION_SCHEMA;
  /** Bank deposit transaction id (string form of transactions.id). */
  deposit_id: string;
  /** Bank-core account id that received the CD funding deposit. */
  account_id: string;
  /** Member wallet address (Bech32) that may claim the minted CDT. */
  owner: string;
  /** Member DID from the core account row (account holder identity). */
  owner_did: string;
  principal: number; // lovelace (see LOVELACE_PER_CENT) — may be stringified in hash path via number
  rate_bps: number;
  start: number; // unix epoch ms
  maturity: number; // unix epoch ms
  penalty_bps: number;
}

export interface SignedAttestation {
  payload: AttestationPayload;
  /** base64 Ed25519 signature over `canonicalize(payload)` */
  signature: string;
  algorithm: 'Ed25519';
  /**
   * base64 SPKI DER of the oracle public key. ADVISORY metadata only — it is
   * not covered by the signature. Verifiers must check against a pinned,
   * out-of-band oracle key, never against this embedded field.
   */
  oracle_public_key: string;
  /** Hex-encoded SHA-256 of canonicalize(payload) — mirrors vault datum field. */
  attestation_hash_hex: string;
}

export interface AttestationInputs {
  transactionId: number;
  accountId: number;
  walletAddress: string;
  ownerDid: string;
  amountCents: bigint;
  rateBps: number;
  penaltyBps: number;
  termMonths: number;
  /** attestation start time in epoch ms; defaults to Date.now() */
  now?: number;
}

/** SHA-256 over canonical JSON of the attestation payload (32 bytes). */
export function attestationHash(payload: AttestationPayload): Buffer {
  return createHash('sha256').update(canonicalize(payload), 'utf8').digest();
}

export function attestationHashHex(payload: AttestationPayload): string {
  return attestationHash(payload).toString('hex');
}

export function buildAttestationPayload(inputs: AttestationInputs): AttestationPayload {
  const start = inputs.now ?? Date.now();
  const principal = centsToLovelace(inputs.amountCents);
  if (principal > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`principal ${principal} lovelace exceeds Number.MAX_SAFE_INTEGER`);
  }
  if (!Number.isFinite(inputs.accountId) || inputs.accountId <= 0) {
    throw new RangeError('accountId must be a positive number');
  }
  if (typeof inputs.ownerDid !== 'string' || inputs.ownerDid.length === 0) {
    throw new RangeError('ownerDid is required for account-bound attestation');
  }
  if (typeof inputs.walletAddress !== 'string' || inputs.walletAddress.length === 0) {
    throw new RangeError('walletAddress is required');
  }
  return {
    schema: ATTESTATION_SCHEMA,
    deposit_id: String(inputs.transactionId),
    account_id: String(inputs.accountId),
    owner: inputs.walletAddress,
    owner_did: inputs.ownerDid,
    principal: Number(principal),
    rate_bps: inputs.rateBps,
    start,
    maturity: start + inputs.termMonths * MS_PER_MONTH,
    penalty_bps: inputs.penaltyBps,
  };
}

export function signAttestation(
  payload: AttestationPayload,
  oraclePrivateKey: KeyObject,
  oraclePublicKey: KeyObject | string,
): SignedAttestation {
  return {
    payload,
    signature: signUtf8(canonicalize(payload), oraclePrivateKey),
    algorithm: 'Ed25519',
    oracle_public_key:
      typeof oraclePublicKey === 'string' ? oraclePublicKey : publicKeyToBase64(oraclePublicKey),
    attestation_hash_hex: attestationHashHex(payload),
  };
}

/**
 * Verify a signed attestation against an oracle public key (base64 SPKI or
 * KeyObject).
 *
 * SECURITY: `oraclePublicKey` MUST be the oracle key the verifier trusts,
 * obtained out-of-band (pinned in config / on-chain parameter). Never pass
 * `signed.oracle_public_key` here — that field is advisory metadata carried
 * for operator convenience; an attacker who forges the whole object can make
 * a self-signed attestation "verify" against its own embedded key.
 */
export function verifyAttestation(signed: SignedAttestation, oraclePublicKey: KeyObject | string): boolean {
  if (signed.payload.schema !== ATTESTATION_SCHEMA) return false;
  if (!signed.payload.account_id || !signed.payload.deposit_id || !signed.payload.owner_did) {
    return false;
  }
  const expectedHash = attestationHashHex(signed.payload);
  if (signed.attestation_hash_hex !== expectedHash) return false;
  const key = typeof oraclePublicKey === 'string' ? publicKeyFromBase64(oraclePublicKey) : oraclePublicKey;
  return verifyUtf8(canonicalize(signed.payload), signed.signature, key);
}
