/**
 * Minimal HS256 JWT for institutional inter-CU API auth.
 *
 * Claims:
 *   role: "issuer" | "correspondent"
 *   sub: institution id / operator id
 *   iat, exp: unix seconds
 *
 * No external deps — Node crypto HMAC-SHA256.
 * Production: set CDT_JWT_SECRET (≥32 random bytes). Prefer short TTL.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type JwtRole = "issuer" | "correspondent";

export interface CdtJwtClaims {
  role: JwtRole;
  sub: string;
  iat: number;
  exp: number;
  /** Optional presentment / desk scope. */
  scope?: string;
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlJson(value: unknown): string {
  return b64url(JSON.stringify(value));
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

export function signJwt(
  claims: Omit<CdtJwtClaims, "iat" | "exp"> & { ttlSec?: number },
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): string {
  if (!secret || secret.length < 16) {
    throw new Error("JWT secret must be at least 16 characters.");
  }
  if (claims.role !== "issuer" && claims.role !== "correspondent") {
    throw new Error("JWT role must be issuer or correspondent.");
  }
  const ttl = claims.ttlSec ?? 3600;
  const body: CdtJwtClaims = {
    role: claims.role,
    sub: claims.sub,
    iat: nowSec,
    exp: nowSec + ttl,
    ...(claims.scope ? { scope: claims.scope } : {}),
  };
  const header = b64urlJson({ alg: "HS256", typ: "JWT" });
  const payload = b64urlJson(body);
  const data = `${header}.${payload}`;
  const sig = createHmac("sha256", secret).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

export function verifyJwt(
  token: string,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): { ok: true; claims: CdtJwtClaims } | { ok: false; reason: string } {
  if (!secret) return { ok: false, reason: "JWT secret not configured." };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "Malformed JWT." };
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  try {
    const header = JSON.parse(fromB64url(headerB64).toString("utf8")) as {
      alg?: string;
    };
    if (header.alg !== "HS256") {
      return { ok: false, reason: "Unsupported JWT algorithm." };
    }
    const data = `${headerB64}.${payloadB64}`;
    const expected = createHmac("sha256", secret).update(data).digest();
    const actual = fromB64url(sigB64);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { ok: false, reason: "Invalid JWT signature." };
    }
    const claims = JSON.parse(fromB64url(payloadB64).toString("utf8")) as CdtJwtClaims;
    if (claims.role !== "issuer" && claims.role !== "correspondent") {
      return { ok: false, reason: "Invalid JWT role claim." };
    }
    if (typeof claims.sub !== "string" || !claims.sub) {
      return { ok: false, reason: "Missing JWT sub." };
    }
    if (typeof claims.exp !== "number" || claims.exp <= nowSec) {
      return { ok: false, reason: "JWT expired." };
    }
    if (typeof claims.iat === "number" && claims.iat > nowSec + 60) {
      return { ok: false, reason: "JWT iat in the future." };
    }
    return { ok: true, claims };
  } catch {
    return { ok: false, reason: "JWT parse error." };
  }
}
