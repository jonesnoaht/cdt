/**
 * E2E credit-claim lifecycle against local bank-sim Postgres.
 * Prereq: npm run db:up && npm run db:apply
 *
 *   npx tsx scripts/credit-claim-lifecycle.ts
 */
import { createPool } from "../src/db.js";
import { seed } from "../src/seed.js";
import {
  drawAndPayPresentment,
  getFacility,
  markPresentmentBurned,
  openFacility,
  requestPresentment,
  runMaturityWaterfall,
} from "../src/facility.js";

async function main() {
  const pool = createPool();
  try {
    const seeded = await seed(pool);
    const now = new Date("2026-01-01T00:00:00.000Z");

    console.log("1. open facility (CD + LOC, mint supply = limit)");
    const facility = await openFacility(pool, {
      accountId: seeded.cdFundingIds[0]!,
      productId: seeded.productIds[0]!,
      principalCents: 10_000_00,
      ltvBps: 9000,
      locSpreadBps: 250,
      depositorWallet: "addr_demo_depositor",
      now,
    });
    console.log(
      `   facility=${facility.id} series=${facility.seriesId} limit=${facility.limitCents} supply=${facility.onChainSupplyCents}`,
    );
    if (facility.limitCents !== 9_000_00 || facility.onChainSupplyCents !== 9_000_00) {
      throw new Error("expected limit and supply 900000");
    }

    console.log("2. transfer (bearer — off-chain / wallet; no core change)");
    console.log("   (simulated: holder wallet now controls claim units)");

    console.log("3. present → pay → burn (draw depositor LOC)");
    const p = await requestPresentment(pool, {
      facilityId: facility.id,
      amountCents: 1_000_00,
      presenterWallet: "addr_holder",
      cipRef: "cip-lifecycle",
    });
    await drawAndPayPresentment(pool, p.id);
    await markPresentmentBurned(pool, p.id, "tx_lifecycle_burn");
    const mid = await getFacility(pool, facility.id);
    console.log(
      `   drawn=${mid.drawnCents} available=${mid.availableCents} supply=${mid.onChainSupplyCents}`,
    );
    if (mid.drawnCents !== 1_000_00 || mid.onChainSupplyCents !== 8_000_00) {
      throw new Error("presentment accounting mismatch");
    }

    const { rows: cert } = await pool.query(
      `SELECT principal_cents FROM certificates WHERE id = $1`,
      [facility.certificateId],
    );
    if (Number(cert[0].principal_cents) !== 10_000_00) {
      throw new Error("CD principal must remain intact");
    }
    console.log("   CD principal intact; coupon still to depositor");

    console.log("4. maturity waterfall");
    const result = await runMaturityWaterfall(pool, facility.id, {
      now: new Date("2027-01-01T00:00:00.000Z"),
    });
    console.log(
      `   status=${result.facility.status} repaidLoc=${result.repaidLocCents} residual=${result.residualToDepositorCents}`,
    );
    if (result.facility.status !== "closed" || result.facility.onChainSupplyCents !== 0) {
      throw new Error("waterfall did not close facility / clear supply");
    }

    console.log("OK credit-claim lifecycle");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
