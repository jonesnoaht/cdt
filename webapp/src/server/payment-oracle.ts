/**
 * Payment-terminal verification contract (opt-in).
 *
 * CDT native assets remain freely spendable on-chain. This module does NOT
 * constrain transfers. Terminals that want extra security call the oracle to
 * check the issuer's mint/deposit attestation is still live before accepting
 * a CDT as payment consideration.
 *
 * Contract (request/response shapes are the stable surface):
 *
 *   1. POST /api/payment/challenge
 *        → { challenge, expiresAtMs }
 *
 *   2. POST /api/payment/verify
 *        body: PaymentVerifyRequest
 *        → PaymentVerifyResponse
 *          - ok:false when claim missing/pending/expired challenge
 *          - ok:true with oracle-signed PaymentCheckPayload
 *
 *   3. Terminal verifies `signature` over canonical JSON of `payload`
 *      using the pinned oracle public key (GET /api/payment/oracle-pubkey).
 *
 *   4. Optional: POST /api/payment/verify-signature re-checks a signed check
 *      (useful for multi-party terminals).
 */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import type pg from "pg";
import type {
  PaymentCheckPayload,
  PaymentOraclePubKeyDto,
  PaymentVerifyRequest,
  PaymentVerifyResponse,
  SignedPaymentCheck,
} from "../shared/types.js";
import { lookupClaim } from "./presentments.js";

const CHALLENGE_TTL_MS = 5 * 60_000;
const CHECK_TTL_MS = 2 * 60_000;

function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}

export class PaymentOracle {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private readonly publicKeySpkiB64: string;
  /** challenge → expiresAtMs */
  private challenges = new Map<string, number>();

  constructor(opts?: { privateKeyPem?: string }) {
    if (opts?.privateKeyPem) {
      this.privateKey = createPrivateKey(opts.privateKeyPem);
      this.publicKey = createPublicKey(this.privateKey);
    } else {
      const pair = generateKeyPairSync("ed25519");
      this.privateKey = pair.privateKey;
      this.publicKey = pair.publicKey;
    }
    this.publicKeySpkiB64 = this.publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64");
  }

  pubkey(): PaymentOraclePubKeyDto {
    return {
      algorithm: "Ed25519",
      publicKeySpkiBase64: this.publicKeySpkiB64,
      purpose:
        "Opt-in payment-terminal attestation checks. Does not restrict free CDT transfers on-chain.",
    };
  }

  issueChallenge(nowMs: number): { challenge: string; expiresAtMs: number } {
    this.gc(nowMs);
    const challenge = cryptoRandomId();
    const expiresAtMs = nowMs + CHALLENGE_TTL_MS;
    this.challenges.set(challenge, expiresAtMs);
    return { challenge, expiresAtMs };
  }

  async verify(
    pool: pg.Pool,
    body: PaymentVerifyRequest,
    nowMs: number,
  ): Promise<PaymentVerifyResponse> {
    this.gc(nowMs);

    if (typeof body.claimRef !== "string" || !body.claimRef.trim()) {
      return { ok: false, reason: "claimRef is required." };
    }
    if (typeof body.merchantId !== "string" || !body.merchantId.trim()) {
      return { ok: false, reason: "merchantId is required." };
    }
    if (typeof body.challenge !== "string" || !body.challenge) {
      return { ok: false, reason: "challenge is required (request one first)." };
    }

    const challengeExp = this.challenges.get(body.challenge);
    if (challengeExp === undefined) {
      return { ok: false, reason: "Unknown or already-consumed challenge." };
    }
    if (challengeExp <= nowMs) {
      this.challenges.delete(body.challenge);
      return { ok: false, reason: "Challenge expired; request a new one." };
    }
    // One-time use
    this.challenges.delete(body.challenge);

    const claim = await lookupClaim(pool, body.claimRef.trim(), nowMs);
    if (!claim) {
      return { ok: false, reason: "No certificate found for that claim reference." };
    }
    if (claim.claim.status === "pending" || !claim.claim.depositId) {
      return {
        ok: false,
        reason: "Claim is not oracle-attested yet; refuse payment until attestation exists.",
        claimSummary: {
          transactionId: claim.claim.transactionId,
          depositId: claim.claim.depositId,
          status: claim.claim.status,
          holderName: claim.holderName,
        },
      };
    }

    if (
      typeof body.payerWallet === "string" &&
      body.payerWallet.trim() &&
      body.payerWallet.trim() !== claim.holderWallet
    ) {
      return {
        ok: false,
        reason: "payerWallet does not match the attested certificate owner wallet.",
        claimSummary: {
          transactionId: claim.claim.transactionId,
          depositId: claim.claim.depositId,
          status: claim.claim.status,
          holderName: claim.holderName,
        },
      };
    }

    if (
      body.amountCents !== undefined &&
      (typeof body.amountCents !== "number" ||
        !Number.isSafeInteger(body.amountCents) ||
        body.amountCents <= 0)
    ) {
      return { ok: false, reason: "amountCents must be a positive integer when provided." };
    }

    // Advisory only: free-spend paradigm means face value is not locked to invoice.
    // We still flag invoices larger than certificate principal.
    if (
      typeof body.amountCents === "number" &&
      body.amountCents > claim.claim.principalCents
    ) {
      return {
        ok: false,
        reason: `Invoice ${body.amountCents} cents exceeds certificate principal ${claim.claim.principalCents} cents.`,
        claimSummary: {
          transactionId: claim.claim.transactionId,
          depositId: claim.claim.depositId,
          status: claim.claim.status,
          holderName: claim.holderName,
        },
      };
    }

    const payload: PaymentCheckPayload = {
      schema: "cdt.payment_check.v1",
      freelySpendable: true,
      depositId: claim.claim.depositId,
      transactionId: claim.claim.transactionId,
      status: claim.claim.status,
      principalCents: claim.claim.principalCents,
      rateBps: claim.claim.rateBps,
      ownerWallet: claim.holderWallet,
      ownerDid: claim.holderDid,
      holderName: claim.holderName,
      issuerName: claim.issuerName,
      merchantId: body.merchantId.trim(),
      amountCents: body.amountCents ?? null,
      challenge: body.challenge,
      checkedAtMs: nowMs,
      expiresAtMs: nowMs + CHECK_TTL_MS,
      mintTxHash: claim.claim.txHash,
    };

    const signature = cryptoSign(null, Buffer.from(canonicalize(payload), "utf8"), this.privateKey);
    const signed: SignedPaymentCheck = {
      payload,
      signature: signature.toString("base64"),
      algorithm: "Ed25519",
      oraclePublicKeySpkiBase64: this.publicKeySpkiB64,
    };

    return {
      ok: true,
      signedCheck: signed,
      advice: [
        "CDT is freely transferable; this check does not freeze or lock the token.",
        "Re-verify if the check expires, or if you have not yet received the on-chain payment.",
        "Prefer matching payer wallet to ownerWallet before treating delivery as final.",
        "Pin oraclePublicKeySpkiBase64 out-of-band; do not trust only the key embedded in the response.",
      ],
    };
  }

  verifySignedCheck(signed: SignedPaymentCheck, nowMs: number): { valid: boolean; reason?: string } {
    if (signed.algorithm !== "Ed25519") {
      return { valid: false, reason: "Unsupported algorithm." };
    }
    if (signed.oraclePublicKeySpkiBase64 !== this.publicKeySpkiB64) {
      return { valid: false, reason: "Oracle public key does not match this service's pinned key." };
    }
    if (signed.payload.expiresAtMs <= nowMs) {
      return { valid: false, reason: "Payment check has expired." };
    }
    try {
      const ok = cryptoVerify(
        null,
        Buffer.from(canonicalize(signed.payload), "utf8"),
        this.publicKey,
        Buffer.from(signed.signature, "base64"),
      );
      return ok ? { valid: true } : { valid: false, reason: "Invalid signature." };
    } catch {
      return { valid: false, reason: "Malformed signature." };
    }
  }

  private gc(nowMs: number): void {
    for (const [c, exp] of this.challenges) {
      if (exp <= nowMs) this.challenges.delete(c);
    }
  }
}

function cryptoRandomId(): string {
  return randomBytes(16).toString("hex");
}
