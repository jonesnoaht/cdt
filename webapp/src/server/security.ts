/**
 * Security middleware for the CDT webapp API.
 *
 * - API key auth on mutating / sensitive routes (Bearer or X-API-Key)
 * - Simple in-memory rate limiting
 * - Baseline security headers
 * - Localhost-only bind is enforced in main.ts via HOST
 */
import type { Context, MiddlewareHandler, Next } from "hono";
import { timingSafeEqual } from "node:crypto";

export interface RateLimitState {
  /** window start ms */
  windowStart: number;
  count: number;
}

const rateBuckets = new Map<string, RateLimitState>();

/** Timing-safe string compare. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("X-Frame-Options", "DENY");
    c.res.headers.set("Referrer-Policy", "no-referrer");
    c.res.headers.set("Cache-Control", "no-store");
    c.res.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
    );
  };
}

/**
 * Require `Authorization: Bearer <key>` or `X-API-Key: <key>` when
 * `apiKey` is configured. Health and public contract metadata stay open.
 */
export function requireApiKey(apiKey: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    if (!apiKey) {
      return c.json(
        {
          error:
            "API key not configured. Set CDT_API_KEY (or pass apiKey to createApp). Refusing unauthenticated access.",
        },
        503,
      );
    }
    const header =
      c.req.header("x-api-key") ??
      c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!header || !safeEqual(header, apiKey)) {
      return c.json({ error: "Unauthorized." }, 401);
    }
    await next();
  };
}

/**
 * Rate limit by client IP (or x-forwarded-for first hop). Returns 429 when
 * exceeded.
 */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  keyFn?: (c: Context) => string;
}): MiddlewareHandler {
  const keyFn =
    opts.keyFn ??
    ((c: Context) =>
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      "local");

  return async (c, next) => {
    const now = Date.now();
    const key = keyFn(c);
    let bucket = rateBuckets.get(key);
    if (!bucket || now - bucket.windowStart >= opts.windowMs) {
      bucket = { windowStart: now, count: 0 };
      rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > opts.max) {
      return c.json({ error: "Rate limit exceeded. Try again later." }, 429);
    }
    await next();
  };
}

/** Clear rate limit state (tests). */
export function resetRateLimits(): void {
  rateBuckets.clear();
}

/** Paths that stay public even with API key mode. */
export function isPublicPath(path: string): boolean {
  return (
    path === "/api/health" ||
    path === "/api/payment/contract" ||
    path === "/api/payment/oracle-pubkey" ||
    path === "/api/correspondent/meta" ||
    path === "/api/settlement/pubkey"
  );
}

export async function publicOrAuthed(
  apiKey: string | undefined,
  c: Context,
  next: Next,
): Promise<Response | void> {
  if (isPublicPath(c.req.path)) {
    return next();
  }
  return requireApiKey(apiKey)(c, next);
}
