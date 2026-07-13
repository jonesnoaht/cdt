//// Unit and property tests for `cdt/interest`.

use aiken/fuzz
use cdt/interest

// -- Unit tests: known values ----------------------------------------------------

/// 100 ADA at 5% for exactly one year: 5 ADA of interest.
test full_interest_one_year() {
  interest.full_interest(100_000_000, 500, 0, interest.year_ms) == 5_000_000
}

test accrued_at_half_term() {
  interest.accrued(100_000_000, 500, 0, interest.year_ms, interest.year_ms / 2) == 2_500_000
}

test accrued_clamps_below_start() {
  interest.accrued(100_000_000, 500, 1_000, 2_000_000, 0) == 0
}

test accrued_clamps_above_maturity() {
  let full = interest.full_interest(100_000_000, 500, 0, interest.year_ms)
  interest.accrued(100_000_000, 500, 0, interest.year_ms, interest.year_ms * 10) == full
}

test penalty_fee_is_floor() {
  // 2_500_000 * 3_000 / 10_000 = 750_000
  interest.penalty_fee(2_500_000, 3_000) == 750_000
}

test early_payout_at_half_term() {
  interest.early_payout(
    100_000_000,
    500,
    0,
    interest.year_ms,
    3_000,
    interest.year_ms / 2,
  ) == 101_750_000
}

test mature_payout_known_value() {
  interest.mature_payout(100_000_000, 500, 0, interest.year_ms) == 105_000_000
}

// -- Fuzzers ----------------------------------------------------------------------

/// (principal, rate_bps, start, maturity, penalty_bps)
fn cd_terms() -> Fuzzer<(Int, Int, Int, Int, Int)> {
  fuzz.map5(
    // Up to 1M ADA.
    fuzz.int_between(1, 1_000_000_000_000),
    // 0% to 20% annual.
    fuzz.int_between(0, 2_000),
    fuzz.int_between(0, 2_000_000_000_000),
    // 1 ms to ~20 years of term length.
    fuzz.int_between(1, 20 * interest.year_ms),
    // Penalty can never exceed accrued interest: at most 10_000 bps.
    fuzz.int_between(0, 10_000),
    fn(principal, rate, start, term, penalty) {
      (principal, rate, start, start + term, penalty)
    },
  )
}

/// CD terms plus two ordered times t1 <= t2 (possibly outside the term).
fn cd_terms_and_times() -> Fuzzer<((Int, Int, Int, Int, Int), Int, Int)> {
  fuzz.and_then(
    cd_terms(),
    fn(terms) {
      let (_, _, start, maturity, _) = terms
      let slack = ( maturity - start ) / 4 + 1
      fuzz.map2(
        fuzz.int_between(start - slack, maturity + slack),
        fuzz.int_between(start - slack, maturity + slack),
        fn(a, b) {
          if a <= b {
            (terms, a, b)
          } else {
            (terms, b, a)
          }
        },
      )
    },
  )
}

// -- Property tests -----------------------------------------------------------------

/// Accrued interest never decreases as time passes.
test prop_accrued_monotonic_in_t(args via cd_terms_and_times()) {
  let ((principal, rate, start, maturity, _), t1, t2) = args
  interest.accrued(principal, rate, start, maturity, t1) <= interest.accrued(
    principal,
    rate,
    start,
    maturity,
    t2,
  )
}

/// Accrued interest is capped by the full-term interest, for any t.
test prop_accrued_le_full_interest(args via cd_terms_and_times()) {
  let ((principal, rate, start, maturity, _), t, _) = args
  interest.accrued(principal, rate, start, maturity, t) <= interest.full_interest(
    principal,
    rate,
    start,
    maturity,
  )
}

/// Leaving early never pays more than holding to maturity.
test prop_early_le_mature(args via cd_terms_and_times()) {
  let ((principal, rate, start, maturity, penalty), t, _) = args
  interest.early_payout(principal, rate, start, maturity, penalty, t) <= interest.mature_payout(
    principal,
    rate,
    start,
    maturity,
  )
}

/// As long as the penalty is a slice of accrued interest (penalty_bps <=
/// 10_000), the owner always gets at least the principal back.
test prop_payouts_ge_principal(args via cd_terms_and_times()) {
  let ((principal, rate, start, maturity, penalty), t, _) = args
  and {
    interest.early_payout(principal, rate, start, maturity, penalty, t) >= principal,
    interest.mature_payout(principal, rate, start, maturity) >= principal,
  }
}

/// The penalty fee never exceeds what has accrued.
test prop_penalty_le_accrued(args via cd_terms_and_times()) {
  let ((principal, rate, start, maturity, penalty), t, _) = args
  let acc = interest.accrued(principal, rate, start, maturity, t)
  interest.penalty_fee(acc, penalty) <= acc
}

/// Accrued at (or after) maturity is exactly the full interest.
test prop_accrued_at_maturity_is_full(args via cd_terms()) {
  let (principal, rate, start, maturity, _) = args
  interest.accrued(principal, rate, start, maturity, maturity) == interest.full_interest(
    principal,
    rate,
    start,
    maturity,
  )
}
