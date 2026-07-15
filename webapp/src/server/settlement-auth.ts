/**
 * Issuer settlement signing: SettlementAuth payloads for the multi-CU
 * burn-and-settle network (docs/network/05-messaging-protocol.md).
 *
 * Lab: ephemeral key if SETTLEMENT_SIGNING_KEY_PEM unset.
 * Production: pin SETTLEMENT_SIGNING_KEY_PEM and expose only the public SPKI.
 */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

export interface SettlementAuthPayload {
  presentment_id: string;
  deposit_id: string;
  redeemer_institution_id: string;
  cash_out_cents: number;
  cash_out_mode: "mature" | "early";
  burn_required: true;
  issued_at: string;
  expires_at: string;
  issuer_institution_id: string;
  schema: "cdt.settlement_auth.v1";
}

export interface SignedSettlementAuth {
  payload: SettlementAuthPayload;
  signature: string;
  algorithm: "Ed25519";
  publicKeySpkiBase64: string;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

export class SettlementSigner {
  private readonly privateKey: KeyObject;
  readonly publicKeySpkiBase64: string;
  readonly issuerInstitutionId: string;
  readonly authTtlMs: number;

  constructor(opts?: {
    privateKeyPem?: string;
    issuerInstitutionId?: string;
    authTtlMs?: number;
  }) {
    if (opts?.privateKeyPem) {
      this.privateKey = createPrivateKey(opts.privateKeyPem);
    } else {
      const { privateKey } = generateKeyPairSync("ed25519");
      this.privateKey = privateKey;
    }
    this.publicKeySpkiBase64 = createPublicKey(this.privateKey)
      .export({ type: "spki", format: "der" })
      .toString("base64");
    this.issuerInstitutionId = opts?.issuerInstitutionId ?? "cu_campususa";
    this.authTtlMs = opts?.authTtlMs ?? 2 * 60 * 60 * 1000;
  }

  issue(input: {
    presentmentId: string;
    depositId: string;
    redeemerInstitutionId: string;
    cashOutCents: number;
    cashOutMode: "mature" | "early";
    nowMs: number;
  }): SignedSettlementAuth {
    const issued = new Date(input.nowMs).toISOString();
    const expires = new Date(input.nowMs + this.authTtlMs).toISOString();
    const payload: SettlementAuthPayload = {
      schema: "cdt.settlement_auth.v1",
      presentment_id: input.presentmentId,
      deposit_id: input.depositId,
      redeemer_institution_id: input.redeemerInstitutionId,
      cash_out_cents: input.cashOutCents,
      cash_out_mode: input.cashOutMode,
      burn_required: true,
      issued_at: issued,
      expires_at: expires,
      issuer_institution_id: this.issuerInstitutionId,
    };
    const message = canonicalize(payload);
    const signature = sign(null, Buffer.from(message, "utf8"), this.privateKey).toString(
      "base64",
    );
    return {
      payload,
      signature,
      algorithm: "Ed25519",
      publicKeySpkiBase64: this.publicKeySpkiBase64,
    };
  }

  verify(signed: SignedSettlementAuth, nowMs: number): { ok: true } | { ok: false; reason: string } {
    if (signed.algorithm !== "Ed25519") {
      return { ok: false, reason: "Unsupported algorithm." };
    }
    if (signed.publicKeySpkiBase64 !== this.publicKeySpkiBase64) {
      return { ok: false, reason: "SettlementAuth public key is not the issuer pin." };
    }
    const exp = Date.parse(signed.payload.expires_at);
    if (!Number.isFinite(exp) || exp <= nowMs) {
      return { ok: false, reason: "SettlementAuth expired." };
    }
    if (!signed.payload.burn_required) {
      return { ok: false, reason: "burn_required must be true." };
    }
    const message = canonicalize(signed.payload);
    const pub = createPublicKey({
      key: Buffer.from(signed.publicKeySpkiBase64, "base64"),
      format: "der",
      type: "spki",
    });
    const ok = verify(
      null,
      Buffer.from(message, "utf8"),
      pub,
      Buffer.from(signed.signature, "base64"),
    );
    return ok ? { ok: true } : { ok: false, reason: "Invalid SettlementAuth signature." };
  }
}
