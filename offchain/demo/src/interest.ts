/**
 * Off-chain mirror of `onchain-vendored/lib/cdt/interest.ak`.
 *
 * All amounts are integer lovelace; all divisions are floor divisions
 * (bigint `/` truncates, and every operand here is non-negative, so
 * truncation == floor). Times are POSIX milliseconds.
 */

/** Milliseconds in a Julian year (365.25 days). */
export const YEAR_MS = 31_557_600_000n;

export const BPS_DENOMINATOR = 10_000n;

export interface CdTerms {
  /** Principal in lovelace. */
  principal: bigint;
  /** Annual interest rate in basis points. */
  rateBps: bigint;
  /** Term start, POSIX ms. */
  start: bigint;
  /** Maturity, POSIX ms. */
  maturity: bigint;
  /** Early-withdrawal penalty on accrued interest, basis points. */
  penaltyBps: bigint;
}

export function clamp(t: bigint, lo: bigint, hi: bigint): bigint {
  if (t < lo) return lo;
  if (t > hi) return hi;
  return t;
}

/** full_interest = principal * rate_bps * (maturity - start) / (10_000 * YEAR_MS) */
export function fullInterest(terms: CdTerms): bigint {
  return (
    (terms.principal * terms.rateBps * (terms.maturity - terms.start)) /
    (BPS_DENOMINATOR * YEAR_MS)
  );
}

/** accrued(t) = principal * rate_bps * (clamp(t, start, maturity) - start) / (10_000 * YEAR_MS) */
export function accrued(terms: CdTerms, t: bigint): bigint {
  return (
    (terms.principal *
      terms.rateBps *
      (clamp(t, terms.start, terms.maturity) - terms.start)) /
    (BPS_DENOMINATOR * YEAR_MS)
  );
}

/** penalty_fee = accrued(t) * penalty_bps / 10_000 */
export function penaltyFee(accruedAmount: bigint, penaltyBps: bigint): bigint {
  return (accruedAmount * penaltyBps) / BPS_DENOMINATOR;
}

/** early_payout = principal + accrued(t) - penalty_fee */
export function earlyPayout(terms: CdTerms, t: bigint): bigint {
  const acc = accrued(terms, t);
  return terms.principal + acc - penaltyFee(acc, terms.penaltyBps);
}

/** mature_payout = principal + full_interest */
export function maturePayout(terms: CdTerms): bigint {
  return terms.principal + fullInterest(terms);
}
