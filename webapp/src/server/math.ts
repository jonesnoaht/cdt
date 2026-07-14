/**
 * Interest math — imported straight from `@cdt/txlib`'s source so the
 * portal's displayed numbers are computed by the exact same code that
 * mirrors the on-chain Aiken validator. Never reimplement this math here.
 *
 * We import the module by path (rather than as a `file:` package dependency)
 * because txlib's package entry points at its compiled `dist/`, and its
 * `prepare` build cannot run during a clean-checkout `npm ci` of this
 * package. `interest.ts` is a self-contained, dependency-free module, so a
 * source import is safe and keeps heavy transaction-building dependencies
 * out of the webapp.
 */
export {
  BPS_DENOMINATOR,
  YEAR_MS,
  accrued,
  clamp,
  earlyPayout,
  fullInterest,
  maturePayout,
  penaltyFee,
} from "../../../offchain/cdt-txlib/src/interest.js";

/**
 * Demo peg used by the oracle watcher: 1 USD = 1 ADA, so 1 cent = 10,000
 * lovelace (see offchain/oracle-watcher/src/attestation.ts).
 */
export const LOVELACE_PER_CENT = 10_000n;

/**
 * Average Gregorian month in ms (365.2425 days / 12) — mirrors the oracle
 * watcher's MS_PER_MONTH. Used only to *estimate* the maturity of a deposit
 * that has not been attested yet; once attested, the signed payload's
 * start/maturity are authoritative.
 */
export const ESTIMATED_MS_PER_MONTH = 2_629_800_000;

export function centsToLovelace(cents: bigint): bigint {
  return cents * LOVELACE_PER_CENT;
}

/** Floor-convert lovelace back to display cents. */
export function lovelaceToCents(lovelace: bigint): number {
  return Number(lovelace / LOVELACE_PER_CENT);
}
