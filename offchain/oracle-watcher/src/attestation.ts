import { type KeyObject } from 'node:crypto';
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

export function centsToLovelace(amountCents: bigint): bigint {
  return amountCents * LOVELACE_PER_CENT;
}

/** The payload the on-chain minting policy consumes. */
export interface AttestationPayload {
  deposit_id: string;
  owner: string; // member wallet address that may claim the minted CDT
  principal: number; // lovelace (see LOVELACE_PER_CENT)
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
}

export interface AttestationInputs {
  transactionId: number;
  walletAddress: string;
  amountCents: bigint;
  rateBps: number;
  penaltyBps: number;
  termMonths: number;
  /** attestation start time in epoch ms; defaults to Date.now() */
  now?: number;
}

export function buildAttestationPayload(inputs: AttestationInputs): AttestationPayload {
  const start = inputs.now ?? Date.now();
  const principal = centsToLovelace(inputs.amountCents);
  if (principal > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`principal ${principal} lovelace exceeds Number.MAX_SAFE_INTEGER`);
  }
  return {
    deposit_id: String(inputs.transactionId),
    owner: inputs.walletAddress,
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
    oracle_public_key: typeof oraclePublicKey === 'string' ? oraclePublicKey : publicKeyToBase64(oraclePublicKey),
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
  const key = typeof oraclePublicKey === 'string' ? publicKeyFromBase64(oraclePublicKey) : oraclePublicKey;
  return verifyUtf8(canonicalize(signed.payload), signed.signature, key);
}
