/**
 * Interest math mirror for the CDT vault validator.
 *
 * All arithmetic uses `bigint` with floor division and MUST match the
 * on-chain Aiken math exactly:
 *
 * ```
 * YEAR_MS       = 31_557_600_000
 * full_interest = principal * rate_bps * (maturity - start) / (10_000 * YEAR_MS)
 * accrued(t)    = principal * rate_bps * (clamp(t, start, maturity) - start) / (10_000 * YEAR_MS)
 * penalty_fee   = accrued(t) * penalty_bps / 10_000
 * early_payout  = principal + accrued(t) - penalty_fee
 * mature_payout = principal + full_interest
 * ```
 *
 * All inputs are validated to be non-negative (and `maturity >= start`) so
 * that JavaScript's truncating `/` on `bigint` coincides with floor
 * division, exactly as on-chain.
 */

/** Milliseconds in a (Julian) year: 365.25 days. */
export const YEAR_MS = 31_557_600_000n;

/** Basis-point denominator. */
export const BPS_DENOMINATOR = 10_000n;

function assertNonNegative(name: string, value: bigint): void {
  if (value < 0n) {
    throw new RangeError(`${name} must be non-negative, got ${value}`);
  }
}

function assertTerms(
  principal: bigint,
  rateBps: bigint,
  start: bigint,
  maturity: bigint,
): void {
  assertNonNegative("principal", principal);
  assertNonNegative("rateBps", rateBps);
  assertNonNegative("start", start);
  assertNonNegative("maturity", maturity);
  if (maturity < start) {
    throw new RangeError(
      `maturity (${maturity}) must be >= start (${start})`,
    );
  }
}

/** Clamp `t` into the inclusive range `[lo, hi]`. Requires `lo <= hi`. */
export function clamp(t: bigint, lo: bigint, hi: bigint): bigint {
  if (lo > hi) throw new RangeError(`clamp: lo (${lo}) must be <= hi (${hi})`);
  if (t < lo) return lo;
  if (t > hi) return hi;
  return t;
}

/**
 * Simple interest over the full CD term (floor division):
 * `principal * rate_bps * (maturity - start) / (10_000 * YEAR_MS)`.
 */
export function fullInterest(
  principal: bigint,
  rateBps: bigint,
  start: bigint,
  maturity: bigint,
): bigint {
  assertTerms(principal, rateBps, start, maturity);
  return (principal * rateBps * (maturity - start)) / (BPS_DENOMINATOR * YEAR_MS);
}

/**
 * Interest accrued at time `t` (POSIX ms), with `t` clamped into
 * `[start, maturity]`.
 */
export function accrued(
  principal: bigint,
  rateBps: bigint,
  start: bigint,
  maturity: bigint,
  t: bigint,
): bigint {
  assertTerms(principal, rateBps, start, maturity);
  const elapsed = clamp(t, start, maturity) - start;
  return (principal * rateBps * elapsed) / (BPS_DENOMINATOR * YEAR_MS);
}

/**
 * Early-withdrawal penalty at time `t`:
 * `accrued(t) * penalty_bps / 10_000`.
 */
export function penaltyFee(
  principal: bigint,
  rateBps: bigint,
  start: bigint,
  maturity: bigint,
  penaltyBps: bigint,
  t: bigint,
): bigint {
  assertNonNegative("penaltyBps", penaltyBps);
  return (accrued(principal, rateBps, start, maturity, t) * penaltyBps) / BPS_DENOMINATOR;
}

/**
 * Amount paid to the owner on early withdrawal at time `t`:
 * `principal + accrued(t) - penalty_fee(t)`.
 */
export function earlyPayout(
  principal: bigint,
  rateBps: bigint,
  start: bigint,
  maturity: bigint,
  penaltyBps: bigint,
  t: bigint,
): bigint {
  return (
    principal +
    accrued(principal, rateBps, start, maturity, t) -
    penaltyFee(principal, rateBps, start, maturity, penaltyBps, t)
  );
}

/**
 * Amount paid to the owner at (or after) maturity:
 * `principal + full_interest`.
 */
export function maturePayout(
  principal: bigint,
  rateBps: bigint,
  start: bigint,
  maturity: bigint,
): bigint {
  return principal + fullInterest(principal, rateBps, start, maturity);
}
