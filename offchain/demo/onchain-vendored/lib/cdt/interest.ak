//// Interest math for certificates of deposit.
////
//// All amounts are integer lovelace, all divisions are floor divisions
//// (every operand is non-negative, so Aiken's `/` is a floor division here).
//// Times are POSIX milliseconds.

/// Milliseconds in a Julian year (365.25 days).
pub const year_ms: Int = 31_557_600_000

/// Clamp `t` into the inclusive interval `[lo, hi]`.
pub fn clamp(t: Int, lo: Int, hi: Int) -> Int {
  if t < lo {
    lo
  } else if t > hi {
    hi
  } else {
    t
  }
}

/// Interest earned over the full term.
///
/// full_interest = principal * rate_bps * (maturity - start) / (10_000 * YEAR_MS)
pub fn full_interest(principal: Int, rate_bps: Int, start: Int, maturity: Int) -> Int {
  principal * rate_bps * ( maturity - start ) / ( 10_000 * year_ms )
}

/// Interest accrued at time `t` (clamped into the term).
///
/// accrued(t) = principal * rate_bps * (clamp(t, start, maturity) - start) / (10_000 * YEAR_MS)
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

/// Early-withdrawal penalty: a slice of the accrued interest.
///
/// penalty_fee = accrued(t) * penalty_bps / 10_000
pub fn penalty_fee(accrued_amount: Int, penalty_bps: Int) -> Int {
  accrued_amount * penalty_bps / 10_000
}

/// Payout on early withdrawal at time `t`.
///
/// early_payout = principal + accrued(t) - penalty_fee
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

/// Payout at (or after) maturity.
///
/// mature_payout = principal + full_interest
pub fn mature_payout(principal: Int, rate_bps: Int, start: Int, maturity: Int) -> Int {
  principal + full_interest(principal, rate_bps, start, maturity)
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

const p: Int = 10_000_000_000

// 4.50% APR

const r: Int = 450

test full_interest_one_year() {
  // Exactly one year at 4.50% on 10,000 ADA => 450 ADA.
  full_interest(p, r, 0, year_ms) == 450_000_000
}

test accrued_clamps_before_start() {
  accrued(p, r, 1_000, 2_000, 500) == 0
}

test accrued_clamps_after_maturity() {
  accrued(p, r, 0, year_ms, year_ms * 2) == full_interest(p, r, 0, year_ms)
}

test early_payout_half_term() {
  // Half a year accrued: 225 ADA; 10% penalty: 22.5 ADA.
  let t = year_ms / 2
  let acc = accrued(p, r, 0, year_ms, t)
  let fee = penalty_fee(acc, 1_000)
  and {
    acc == 225_000_000,
    fee == 22_500_000,
    early_payout(p, r, 0, year_ms, 1_000, t) == p + 202_500_000,
  }
}

test short_term_floors() {
  // 120 seconds at 4.50% on 10,000 ADA:
  // 10^10 * 450 * 120_000 / (10^4 * 31_557_600_000) = 1711.15... -> 1711
  full_interest(p, r, 0, 120_000) == 1_711
}
