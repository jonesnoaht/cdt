/**
 * Mobile wallet sign requests.
 *
 * Pattern (recommended for Cardano):
 *   1. Desk / pipeline builds unsigned tx CBOR (hex).
 *   2. POST /api/sign-requests → short id + claimUrl for QR.
 *   3. Phone scans QR → GET claimUrl → wallet signs CBOR.
 *   4. POST /api/sign-requests/:id/complete with signed CBOR / witnesses.
 *
 * Full mint/redeem CBOR is often too large for one QR; the QR encodes the
 * claim URL (or a deep-link wrapper), not the whole transaction.
 *
 * Bluetooth is not used — HTTP + QR / deep link is the mobile path.
 */
import { createHash, randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { buildWalletDeepLinks, deepLinkTemplateForBrand, type WalletBrand } from "./wallet-deeplinks.js";

export type SignRequestPurpose =
  | "redeem"
  | "early_withdraw"
  | "burn"
  | "generic";

export type SignRequestStatus = "pending" | "completed" | "expired" | "cancelled";

export interface SignRequestDto {
  id: string;
  purpose: SignRequestPurpose;
  status: SignRequestStatus;
  depositId?: string;
  presentmentId?: number;
  description: string;
  /** Unsigned transaction CBOR as hex (no 0x). */
  cborHex: string;
  /** SHA-256 of cborHex utf8 for integrity. */
  cborHashHex: string;
  /** Public URL the phone should open (encoded into QR). */
  claimUrl: string;
  /** Optional wallet deep-link wrapper. */
  deepLink?: string;
  /** All known wallet open options for this claim URL. */
  walletLinks?: Array<{
    brand: string;
    label: string;
    url: string | null;
    notes?: string;
  }>;
  /** Data-URL PNG QR of claimUrl. */
  qrDataUrl: string;
  requiredSignerHint?: string;
  expiresAt: string;
  createdAt: string;
  completedAt?: string;
  /** Set after complete. */
  signedCborHex?: string;
  witnessCborHex?: string;
}

export interface CreateSignRequestInput {
  purpose: SignRequestPurpose;
  cborHex: string;
  description?: string;
  depositId?: string;
  presentmentId?: number;
  requiredSignerHint?: string;
  /** Absolute or relative public base for claim URLs (e.g. https://desk.cu/ or /). */
  publicBaseUrl: string;
  /** TTL ms (default 15 min). */
  ttlMs?: number;
  deepLinkTemplate?: string;
  /** Prefer a built-in wallet brand template when deepLinkTemplate omitted. */
  walletBrand?: WalletBrand;
}

function normalizeHex(hex: string): string {
  const h = hex.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(h) || h.length % 2 !== 0) {
    throw new Error("cborHex must be even-length hex");
  }
  if (h.length < 2) throw new Error("cborHex too short");
  return h;
}

function hashHex(cborHex: string): string {
  return createHash("sha256").update(cborHex, "utf8").digest("hex");
}

function newId(): string {
  return randomBytes(16).toString("hex");
}

export class SignRequestStore {
  private byId = new Map<string, SignRequestDto>();

  async create(input: CreateSignRequestInput): Promise<SignRequestDto> {
    const cborHex = normalizeHex(input.cborHex);
    const id = newId();
    const now = Date.now();
    const ttl = input.ttlMs ?? 15 * 60 * 1000;
    const base = input.publicBaseUrl.replace(/\/$/, "");
    // SPA hash route preferred for vite lab; API still works standalone.
    const claimUrl = base.includes("#")
      ? `${base}/sign/${id}`
      : `${base}/#/sign/${id}`;
    const template =
      input.deepLinkTemplate ??
      (input.walletBrand ? deepLinkTemplateForBrand(input.walletBrand) : undefined);
    const deepLink = template
      ? template.replace("{url}", encodeURIComponent(claimUrl)).replace("{id}", id)
      : undefined;
    const walletLinks = buildWalletDeepLinks(claimUrl);
    const qrDataUrl = await QRCode.toDataURL(claimUrl, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 280,
    });
    const dto: SignRequestDto = {
      id,
      purpose: input.purpose,
      status: "pending",
      depositId: input.depositId,
      presentmentId: input.presentmentId,
      description:
        input.description ??
        `Sign ${input.purpose} transaction${input.depositId ? ` for deposit ${input.depositId}` : ""}`,
      cborHex,
      cborHashHex: hashHex(cborHex),
      claimUrl,
      deepLink,
      walletLinks,
      qrDataUrl,
      requiredSignerHint: input.requiredSignerHint,
      expiresAt: new Date(now + ttl).toISOString(),
      createdAt: new Date(now).toISOString(),
    };
    this.byId.set(id, dto);
    return dto;
  }

  get(id: string, nowMs: number = Date.now()): SignRequestDto | undefined {
    const row = this.byId.get(id);
    if (!row) return undefined;
    if (row.status === "pending" && Date.parse(row.expiresAt) <= nowMs) {
      const expired = { ...row, status: "expired" as const };
      this.byId.set(id, expired);
      return expired;
    }
    return row;
  }

  /** Public phone view: omit nothing needed to sign; strip nothing critical. */
  publicView(id: string, nowMs?: number): SignRequestDto | { error: string; status: number } {
    const row = this.get(id, nowMs);
    if (!row) return { error: "Sign request not found.", status: 404 };
    return row;
  }

  complete(
    id: string,
    body: { signedCborHex?: string; witnessCborHex?: string },
    nowMs: number = Date.now(),
  ): SignRequestDto | { error: string; status: number } {
    const row = this.get(id, nowMs);
    if (!row) return { error: "Sign request not found.", status: 404 };
    if (row.status === "expired") {
      return { error: "Sign request expired.", status: 410 };
    }
    if (row.status === "completed") {
      return row; // idempotent
    }
    if (row.status !== "pending") {
      return { error: `Cannot complete in status ${row.status}.`, status: 422 };
    }
    const signed = body.signedCborHex?.trim();
    const witness = body.witnessCborHex?.trim();
    if (!signed && !witness) {
      return {
        error: "Provide signedCborHex and/or witnessCborHex.",
        status: 400,
      };
    }
    try {
      if (signed) normalizeHex(signed);
      if (witness) normalizeHex(witness);
    } catch (err) {
      return { error: String(err), status: 400 };
    }
    const next: SignRequestDto = {
      ...row,
      status: "completed",
      completedAt: new Date(nowMs).toISOString(),
      signedCborHex: signed ? normalizeHex(signed) : undefined,
      witnessCborHex: witness ? normalizeHex(witness) : undefined,
    };
    this.byId.set(id, next);
    return next;
  }

  cancel(id: string, nowMs: number = Date.now()): SignRequestDto | { error: string; status: number } {
    const row = this.get(id, nowMs);
    if (!row) return { error: "Sign request not found.", status: 404 };
    if (row.status === "completed") {
      return { error: "Already completed.", status: 422 };
    }
    const next = { ...row, status: "cancelled" as const };
    this.byId.set(id, next);
    return next;
  }
}
