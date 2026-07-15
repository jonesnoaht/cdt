/**
 * Issuer settlement signing: SettlementAuth payloads for the multi-CU
 * burn-and-settle network (docs/network/05-messaging-protocol.md).
 *
 * Lab: ephemeral key if SETTLEMENT_SIGNING_KEY_PEM unset.
 * Production: pin SETTLEMENT_SIGNING_KEY_PEM and expose only the public SPKI.
 *
 * Dual control (optional):
 *   SETTLEMENT_SECONDARY_SIGNING_KEY_PEM + SETTLEMENT_DUAL_CONTROL=1
 *   Primary desk key signs; secondary officer key must cosign the same payload.
 *   verify() rejects missing/invalid secondary when dualControlRequired is true.
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
  /** Present when dual-control cosign is enabled. */
  secondarySignature?: string;
  secondaryPublicKeySpkiBase64?: string;
}

export function canonicalizeSettlement(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalizeSettlement(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeSettlement(obj[k])}`).join(",")}}`;
}

function spkiB64(key: KeyObject): string {
  return createPublicKey(key)
    .export({ type: "spki", format: "der" })
    .toString("base64");
}

function signMessage(message: string, privateKey: KeyObject): string {
  return sign(null, Buffer.from(message, "utf8"), privateKey).toString("base64");
}

function verifyMessage(
  message: string,
  signatureB64: string,
  publicSpkiB64: string,
): boolean {
  try {
    const pub = createPublicKey({
      key: Buffer.from(publicSpkiB64, "base64"),
      format: "der",
      type: "spki",
    });
    return verify(
      null,
      Buffer.from(message, "utf8"),
      pub,
      Buffer.from(signatureB64, "base64"),
    );
  } catch {
    return false;
  }
}

export class SettlementSigner {
  private readonly privateKey: KeyObject;
  private readonly secondaryPrivateKey?: KeyObject;
  readonly publicKeySpkiBase64: string;
  readonly secondaryPublicKeySpkiBase64?: string;
  readonly issuerInstitutionId: string;
  readonly authTtlMs: number;
  /** When true, verify requires a valid secondary cosign. */
  readonly dualControlRequired: boolean;

  constructor(opts?: {
    privateKeyPem?: string;
    secondaryPrivateKeyPem?: string;
    /** Force dual-control verification even if secondary key not loaded for issue. */
    dualControlRequired?: boolean;
    /** Pin only secondary public SPKI for verify-only nodes. */
    secondaryPublicKeySpkiBase64?: string;
    issuerInstitutionId?: string;
    authTtlMs?: number;
  }) {
    if (opts?.privateKeyPem) {
      this.privateKey = createPrivateKey(opts.privateKeyPem);
    } else {
      const { privateKey } = generateKeyPairSync("ed25519");
      this.privateKey = privateKey;
    }
    this.publicKeySpkiBase64 = spkiB64(this.privateKey);

    if (opts?.secondaryPrivateKeyPem) {
      this.secondaryPrivateKey = createPrivateKey(opts.secondaryPrivateKeyPem);
      this.secondaryPublicKeySpkiBase64 = spkiB64(this.secondaryPrivateKey);
    } else if (opts?.secondaryPublicKeySpkiBase64) {
      this.secondaryPublicKeySpkiBase64 = opts.secondaryPublicKeySpkiBase64;
    }

    this.dualControlRequired =
      opts?.dualControlRequired === true || Boolean(opts?.secondaryPrivateKeyPem);

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
    if (this.dualControlRequired && !this.secondaryPrivateKey) {
      throw new Error(
        "Dual-control SettlementAuth requires SETTLEMENT_SECONDARY_SIGNING_KEY_PEM (or secondaryPrivateKeyPem).",
      );
    }
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
    const message = canonicalizeSettlement(payload);
    const signature = signMessage(message, this.privateKey);
    const out: SignedSettlementAuth = {
      payload,
      signature,
      algorithm: "Ed25519",
      publicKeySpkiBase64: this.publicKeySpkiBase64,
    };
    if (this.secondaryPrivateKey && this.secondaryPublicKeySpkiBase64) {
      out.secondarySignature = signMessage(message, this.secondaryPrivateKey);
      out.secondaryPublicKeySpkiBase64 = this.secondaryPublicKeySpkiBase64;
    }
    return out;
  }

  verify(
    signed: SignedSettlementAuth,
    nowMs: number,
  ): { ok: true } | { ok: false; reason: string } {
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
    const message = canonicalizeSettlement(signed.payload);
    if (!verifyMessage(message, signed.signature, signed.publicKeySpkiBase64)) {
      return { ok: false, reason: "Invalid SettlementAuth signature." };
    }

    if (this.dualControlRequired) {
      if (!this.secondaryPublicKeySpkiBase64) {
        return {
          ok: false,
          reason: "Dual-control configured but secondary public key is not pinned.",
        };
      }
      if (!signed.secondarySignature || !signed.secondaryPublicKeySpkiBase64) {
        return {
          ok: false,
          reason: "Dual-control SettlementAuth requires secondary cosignature.",
        };
      }
      if (signed.secondaryPublicKeySpkiBase64 !== this.secondaryPublicKeySpkiBase64) {
        return {
          ok: false,
          reason: "SettlementAuth secondary public key is not the dual-control pin.",
        };
      }
      if (
        !verifyMessage(
          message,
          signed.secondarySignature,
          signed.secondaryPublicKeySpkiBase64,
        )
      ) {
        return { ok: false, reason: "Invalid SettlementAuth secondary cosignature." };
      }
    }

    return { ok: true };
  }
}

/** Factory from process env for production / lab. */
export function settlementSignerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SettlementSigner {
  return new SettlementSigner({
    privateKeyPem: env.SETTLEMENT_SIGNING_KEY_PEM,
    secondaryPrivateKeyPem: env.SETTLEMENT_SECONDARY_SIGNING_KEY_PEM,
    secondaryPublicKeySpkiBase64: env.SETTLEMENT_SECONDARY_PUBKEY_SPKI,
    dualControlRequired: env.SETTLEMENT_DUAL_CONTROL === "1",
    issuerInstitutionId: env.SETTLEMENT_ISSUER_INSTITUTION_ID,
  });
}
