import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BPS_DENOMINATOR,
  YEAR_MS,
  accrued,
  clamp,
  earlyPayout,
  fullInterest,
  maturePayout,
  penaltyFee,
} from "../src/interest.js";

const ADA = 1_000_000n;

describe("clamp", () => {
  it("clamps below, inside, above", () => {
    expect(clamp(-5n, 0n, 10n)).toBe(0n);
    expect(clamp(5n, 0n, 10n)).toBe(5n);
    expect(clamp(15n, 0n, 10n)).toBe(10n);
  });

  it("rejects inverted bounds", () => {
    expect(() => clamp(0n, 10n, 5n)).toThrow(RangeError);
  });
});

describe("fullInterest", () => {
  it("computes 5% over exactly one year", () => {
    // 1000 ADA at 500 bps for one Julian year -> 50 ADA
    expect(fullInterest(1000n * ADA, 500n, 0n, YEAR_MS)).toBe(50n * ADA);
  });

  it("floors, never rounds", () => {
    // 1 lovelace at 10000 bps for just under a year -> floor(...) = 0
    expect(fullInterest(1n, 10_000n, 0n, YEAR_MS - 1n)).toBe(0n);
    expect(fullInterest(1n, 10_000n, 0n, YEAR_MS)).toBe(1n);
    // 3 lovelace, 1 bps, 1 ms: 3*1*1/(10_000*YEAR_MS) floors to 0
    expect(fullInterest(3n, 1n, 0n, 1n)).toBe(0n);
  });

  it("is zero for a zero-length term or zero rate", () => {
    expect(fullInterest(1000n * ADA, 500n, 5n, 5n)).toBe(0n);
    expect(fullInterest(1000n * ADA, 0n, 0n, YEAR_MS)).toBe(0n);
  });

  it("rejects invalid terms", () => {
    expect(() => fullInterest(-1n, 500n, 0n, 1n)).toThrow(RangeError);
    expect(() => fullInterest(1n, -1n, 0n, 1n)).toThrow(RangeError);
    expect(() => fullInterest(1n, 1n, 10n, 5n)).toThrow(RangeError);
  });
});

describe("accrued", () => {
  const p = 1000n * ADA;
  const start = 1_700_000_000_000n;
  const maturity = start + YEAR_MS;

  it("is zero at (or before) start", () => {
    expect(accrued(p, 500n, start, maturity, start)).toBe(0n);
    expect(accrued(p, 500n, start, maturity, start - 999n)).toBe(0n);
  });

  it("equals fullInterest at (or after) maturity", () => {
    const full = fullInterest(p, 500n, start, maturity);
    expect(accrued(p, 500n, start, maturity, maturity)).toBe(full);
    expect(accrued(p, 500n, start, maturity, maturity + YEAR_MS)).toBe(full);
  });

  it("is exactly half at mid-term (even term)", () => {
    const full = fullInterest(p, 500n, start, maturity);
    expect(accrued(p, 500n, start, maturity, start + YEAR_MS / 2n)).toBe(
      full / 2n,
    );
  });
});

describe("penalty and payouts", () => {
  const p = 1000n * ADA;
  const start = 0n;
  const maturity = YEAR_MS;
  const t = YEAR_MS / 2n; // mid-term
  const rate = 500n;
  const penaltyBps = 2_000n; // 20% of accrued

  it("worked example at mid-term", () => {
    const acc = accrued(p, rate, start, maturity, t); // 25 ADA
    expect(acc).toBe(25n * ADA);
    const fee = penaltyFee(p, rate, start, maturity, penaltyBps, t); // 5 ADA
    expect(fee).toBe(5n * ADA);
    expect(earlyPayout(p, rate, start, maturity, penaltyBps, t)).toBe(
      p + 20n * ADA,
    );
    expect(maturePayout(p, rate, start, maturity)).toBe(p + 50n * ADA);
  });

  it("a 100% penalty forfeits exactly the accrued interest", () => {
    expect(earlyPayout(p, rate, start, maturity, BPS_DENOMINATOR, t)).toBe(p);
  });

  it("a 0% penalty pays out all accrued interest", () => {
    expect(earlyPayout(p, rate, start, maturity, 0n, t)).toBe(
      p + accrued(p, rate, start, maturity, t),
    );
  });
});

describe("properties", () => {
  const principalArb = fc.bigInt({ min: 0n, max: 10n ** 15n });
  const rateArb = fc.bigInt({ min: 0n, max: 10_000n });
  const penaltyArb = fc.bigInt({ min: 0n, max: 10_000n });
  const timeArb = fc.bigInt({ min: 0n, max: 4n * YEAR_MS });
  const termsArb = fc
    .tuple(timeArb, fc.bigInt({ min: 0n, max: 2n * YEAR_MS }))
    .map(([start, len]) => ({ start, maturity: start + len }));

  it("accrued is monotonically non-decreasing in t", () => {
    fc.assert(
      fc.property(
        principalArb,
        rateArb,
        termsArb,
        timeArb,
        timeArb,
        (p, r, { start, maturity }, a, b) => {
          const [t1, t2] = a <= b ? [a, b] : [b, a];
          return (
            accrued(p, r, start, maturity, t1) <=
            accrued(p, r, start, maturity, t2)
          );
        },
      ),
    );
  });

  it("accrued(t) <= fullInterest for all t, with equality at maturity", () => {
    fc.assert(
      fc.property(
        principalArb,
        rateArb,
        termsArb,
        timeArb,
        (p, r, { start, maturity }, t) => {
          const full = fullInterest(p, r, start, maturity);
          const acc = accrued(p, r, start, maturity, t);
          return acc <= full && accrued(p, r, start, maturity, maturity) === full;
        },
      ),
    );
  });

  it("penalty fee never exceeds accrued interest", () => {
    fc.assert(
      fc.property(
        principalArb,
        rateArb,
        termsArb,
        penaltyArb,
        timeArb,
        (p, r, { start, maturity }, pen, t) =>
          penaltyFee(p, r, start, maturity, pen, t) <=
          accrued(p, r, start, maturity, t),
      ),
    );
  });

  it("principal <= earlyPayout <= maturePayout", () => {
    fc.assert(
      fc.property(
        principalArb,
        rateArb,
        termsArb,
        penaltyArb,
        timeArb,
        (p, r, { start, maturity }, pen, t) => {
          const early = earlyPayout(p, r, start, maturity, pen, t);
          const mature = maturePayout(p, r, start, maturity);
          return p <= early && early <= mature;
        },
      ),
    );
  });

  it("all results are floor-divided (division identity holds)", () => {
    fc.assert(
      fc.property(
        principalArb,
        rateArb,
        termsArb,
        (p, r, { start, maturity }) => {
          const full = fullInterest(p, r, start, maturity);
          const numerator = p * r * (maturity - start);
          const denominator = BPS_DENOMINATOR * YEAR_MS;
          const remainder = numerator - full * denominator;
          return 0n <= remainder && remainder < denominator;
        },
      ),
    );
  });
});
