/**
 * Credit-claim facility domain (CD + secured LOC).
 * Prereq: `docker compose up -d --wait` and schema applied.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool } from "../src/db.js";
import { seed, type SeedResult } from "../src/seed.js";
import {
  availableCents,
  drawAndPayPresentment,
  getFacility,
  markPresentmentBurned,
  openFacility,
  reissueFacility,
  requestPresentment,
  runMaturityWaterfall,
} from "../src/facility.js";

let pool: pg.Pool;
let seeded: SeedResult;

beforeAll(async () => {
  pool = createPool();
  seeded = await seed(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("availableCents", () => {
  it("is limit minus drawn minus holds", () => {
    expect(
      availableCents({
        limitCents: 900_00,
        drawnCents: 100_00,
        holdsCents: 50_00,
      }),
    ).toBe(750_00);
  });
});

describe("openFacility", () => {
  it("books a pledged CD and LOC with limit = LTV * principal", async () => {
    const now = new Date("2026-07-16T12:00:00.000Z");
    const facility = await openFacility(pool, {
      accountId: seeded.cdFundingIds[0]!,
      productId: seeded.productIds[0]!,
      principalCents: 10_000_00,
      ltvBps: 9000,
      locSpreadBps: 250,
      depositorWallet: "addr_test1_depositor",
      now,
    });

    expect(facility.limitCents).toBe(9_000_00);
    expect(facility.drawnCents).toBe(0);
    expect(facility.holdsCents).toBe(0);
    expect(facility.availableCents).toBe(9_000_00);
    expect(facility.status).toBe("active");
    expect(facility.onChainSupplyCents).toBe(9_000_00);
    expect(facility.borrowerAccountId).toBe(seeded.cdFundingIds[0]);
    expect(facility.seriesId).toMatch(/^series_/);
    expect(facility.rateBps).toBe(400 + 250); // product 0 is 400 bps in seed

    const again = await getFacility(pool, facility.id);
    expect(again.seriesId).toBe(facility.seriesId);
    expect(availableCents(again)).toBe(9_000_00);

    const { rows } = await pool.query(
      `SELECT principal_cents, status, rate_bps FROM certificates WHERE id = $1`,
      [facility.certificateId],
    );
    expect(Number(rows[0].principal_cents)).toBe(10_000_00);
    expect(rows[0].status).toBe("pledged");
    expect(rows[0].rate_bps).toBe(400);
  });

  it("rejects non-positive principal", async () => {
    await expect(
      openFacility(pool, {
        accountId: seeded.cdFundingIds[0]!,
        productId: seeded.productIds[0]!,
        principalCents: 0,
        depositorWallet: "addr_test1_x",
      }),
    ).rejects.toThrow(/principal/i);
  });

  it("rejects missing product", async () => {
    await expect(
      openFacility(pool, {
        accountId: seeded.cdFundingIds[0]!,
        productId: 999_999,
        principalCents: 1_000_00,
        depositorWallet: "addr_test1_x",
      }),
    ).rejects.toThrow(/cd_product/i);
  });
});

describe("presentment cash-out", () => {
  it("draws depositor LOC and reduces supply mirror on burn", async () => {
    const facility = await openFacility(pool, {
      accountId: seeded.cdFundingIds[1]!,
      productId: seeded.productIds[0]!,
      principalCents: 10_000_00,
      ltvBps: 9000,
      depositorWallet: "addr_dep",
      now: new Date("2026-07-16T12:00:00.000Z"),
    });

    const p = await requestPresentment(pool, {
      facilityId: facility.id,
      amountCents: 1_000_00,
      presenterWallet: "addr_holder",
      presenterName: "Holder",
      cipRef: "cip-demo-ok",
    });
    expect(p.status).toBe("requested");

    const paid = await drawAndPayPresentment(pool, p.id);
    expect(paid.status).toBe("paid");
    const afterDraw = await getFacility(pool, facility.id);
    expect(afterDraw.drawnCents).toBe(1_000_00);
    expect(afterDraw.availableCents).toBe(8_000_00);
    expect(afterDraw.borrowerAccountId).toBe(seeded.cdFundingIds[1]);

    const { rows } = await pool.query(
      `SELECT principal_cents, status FROM certificates WHERE id = $1`,
      [facility.certificateId],
    );
    expect(Number(rows[0].principal_cents)).toBe(10_000_00);
    expect(rows[0].status).toBe("pledged");

    const burned = await markPresentmentBurned(pool, p.id, "tx_burn_abc");
    expect(burned.status).toBe("burned");
    expect(burned.burnTxHash).toBe("tx_burn_abc");
    const afterBurn = await getFacility(pool, facility.id);
    expect(afterBurn.onChainSupplyCents).toBe(8_000_00);
  });

  it("rejects presentment above available", async () => {
    const facility = await openFacility(pool, {
      accountId: seeded.cdFundingIds[2]!,
      productId: seeded.productIds[0]!,
      principalCents: 1_000_00,
      ltvBps: 9000,
      depositorWallet: "addr_dep2",
    });
    await expect(
      requestPresentment(pool, {
        facilityId: facility.id,
        amountCents: facility.limitCents + 1,
        presenterWallet: "addr_x",
        cipRef: "cip-ok",
      }),
    ).rejects.toThrow(/available/i);
  });

  it("rejects missing CIP", async () => {
    const facility = await openFacility(pool, {
      accountId: seeded.cdFundingIds[0]!,
      productId: seeded.productIds[1]!,
      principalCents: 5_000_00,
      depositorWallet: "addr_dep3",
    });
    await expect(
      requestPresentment(pool, {
        facilityId: facility.id,
        amountCents: 100_00,
        presenterWallet: "addr_x",
        cipRef: "",
      }),
    ).rejects.toThrow(/CIP/i);
  });
});

describe("maturity waterfall", () => {
  it("repays LOC then clears CDT supply mirror", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const facility = await openFacility(pool, {
      accountId: seeded.cdFundingIds[0]!,
      productId: seeded.productIds[0]!,
      principalCents: 10_000_00,
      ltvBps: 9000,
      depositorWallet: "addr_w",
      now,
    });
    const p = await requestPresentment(pool, {
      facilityId: facility.id,
      amountCents: 2_000_00,
      presenterWallet: "addr_h",
      cipRef: "cip-ok",
    });
    await drawAndPayPresentment(pool, p.id);
    await markPresentmentBurned(pool, p.id, "tx1");

    const result = await runMaturityWaterfall(pool, facility.id, {
      now: new Date("2027-01-01T00:00:00.000Z"),
    });
    expect(result.repaidLocCents).toBe(2_000_00);
    expect(result.facility.status).toBe("closed");
    expect(result.facility.drawnCents).toBe(0);
    expect(result.facility.onChainSupplyCents).toBe(0);
    expect(result.residualToDepositorCents).toBeGreaterThan(0);
  });
});

describe("reissueFacility", () => {
  it("extends term when supply fits new limit", async () => {
    const facility = await openFacility(pool, {
      accountId: seeded.cdFundingIds[1]!,
      productId: seeded.productIds[1]!,
      principalCents: 10_000_00,
      ltvBps: 9000,
      depositorWallet: "addr_w2",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const re = await reissueFacility(pool, {
      facilityId: facility.id,
      newTermMonths: 12,
      currentOnChainSupplyCents: facility.onChainSupplyCents,
      now: new Date("2026-08-01T00:00:00.000Z"),
    });
    expect(re.status).toBe("active");
    expect(re.maturityAt.getTime()).toBeGreaterThan(facility.maturityAt.getTime());
  });

  it("rejects reissue when supply exceeds new limit", async () => {
    const facility = await openFacility(pool, {
      accountId: seeded.cdFundingIds[2]!,
      productId: seeded.productIds[2]!,
      principalCents: 10_000_00,
      ltvBps: 9000,
      depositorWallet: "addr_w3",
    });
    await expect(
      reissueFacility(pool, {
        facilityId: facility.id,
        newTermMonths: 6,
        newLtvBps: 1000,
        currentOnChainSupplyCents: facility.onChainSupplyCents,
      }),
    ).rejects.toThrow(/supply/i);
  });
});
