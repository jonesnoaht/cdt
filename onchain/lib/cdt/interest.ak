//// Simple-interest math for tokenized certificates of deposit (CDs).
////
//// All amounts are integer lovelace and all divisions are floor divisions,
//// so every function here is exact and deterministic on-chain.
////
//// Times are POSIX timestamps in milliseconds. A "year" is defined as
//// 365.25 days to match the annualised rate quoted in basis points.

/// Milliseconds in a year (365.25 days).
pub const year_ms: Int = 31_557_600_000

/// Clamp `t` into the closed interval `[lo, hi]`.
pub fn clamp(t: Int, lo: Int, hi: Int) -> Int {
  if t < lo {
    lo
  } else if t > hi {
    hi
  } else {
    t
  }
}

/// Interest owed if the CD is held all the way from `start` to `maturity`.
///
/// `full_interest = principal * rate_bps * (maturity - start) / (10_000 * YEAR_MS)`
pub fn full_interest(
  principal: Int,
  rate_bps: Int,
  start: Int,
  maturity: Int,
) -> Int {
  principal * rate_bps * ( maturity - start ) / ( 10_000 * year_ms )
}

/// Interest accrued at time `t`, with `t` clamped into `[start, maturity]`.
///
/// `accrued(t) = principal * rate_bps * (clamp(t, start, maturity) - start) / (10_000 * YEAR_MS)`
pub fn accrued(
  principal: Int,
  rate_bps: Int,
  start: Int,
  maturity: Int,
  t: Int,
) -> Int {
  principal * rate_bps * ( clamp(t, start, maturity) - start ) / (
    10_000 * year_ms
  )
}

/// Early-withdrawal penalty: a slice of the interest accrued so far.
///
/// `penalty_fee = accrued(t) * penalty_bps / 10_000`
pub fn penalty_fee(accrued_interest: Int, penalty_bps: Int) -> Int {
  accrued_interest * penalty_bps / 10_000
}

/// What the owner is entitled to when withdrawing early at time `t`:
/// principal plus accrued interest, minus the penalty fee.
pub fn early_payout(
  principal: Int,
  rate_bps: Int,
  start: Int,
  maturity: Int,
  penalty_bps: Int,
  t: Int,
) -> Int {
  let acc = accrued(principal, rate_bps, start, maturity, t)
  principal + acc - penalty_fee(acc, penalty_bps)
}

/// What the owner is entitled to at (or after) maturity:
/// principal plus the full interest.
pub fn mature_payout(
  principal: Int,
  rate_bps: Int,
  start: Int,
  maturity: Int,
) -> Int {
  principal + full_interest(principal, rate_bps, start, maturity)
}
