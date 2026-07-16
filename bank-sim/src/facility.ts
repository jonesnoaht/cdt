import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Queryable } from "./db.js";
import type {
  CreditFacility,
  FacilityPresentment,
  OpenFacilityInput,
  RequestPresentmentInput,
  ReissueInput,
  WaterfallResult,
} from "./types.js";

export function availableCents(f: {
  limitCents: number;
  drawnCents: number;
  holdsCents: number;
}): number {
  return f.limitCents - f.drawnCents - f.holdsCents;
}

function rowToFacility(row: Record<string, unknown>): CreditFacility {
  const limitCents = Number(row.limit_cents);
  const drawnCents = Number(row.drawn_cents);
  const holdsCents = Number(row.holds_cents);
  return {
    id: row.id as number,
    certificateId: row.certificate_id as number,
    borrowerAccountId: row.borrower_account_id as number,
    seriesId: row.series_id as string,
    limitCents,
    drawnCents,
    holdsCents,
    availableCents: limitCents - drawnCents - holdsCents,
    rateBps: row.rate_bps as number,
    ltvBps: row.ltv_bps as number,
    status: row.status as CreditFacility["status"],
    maturityAt: row.maturity_at as Date,
    onChainSupplyCents: Number(row.on_chain_supply_cents),
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function rowToPresentment(row: Record<string, unknown>): FacilityPresentment {
  return {
    id: row.id as number,
    facilityId: row.facility_id as number,
    amountCents: Number(row.amount_cents),
    presenterWallet: row.presenter_wallet as string,
    presenterName: (row.presenter_name as string) ?? "",
    cipRef: (row.cip_ref as string) ?? "",
    status: row.status as FacilityPresentment["status"],
    burnTxHash: (row.burn_tx_hash as string) ?? null,
    failureReason: (row.failure_reason as string) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

async function appendEvent(
  db: Queryable,
  facilityId: number,
  kind: string,
  payload: unknown,
): Promise<void> {
  await db.query(
    `INSERT INTO facility_events (facility_id, kind, payload) VALUES ($1, $2, $3::jsonb)`,
    [facilityId, kind, JSON.stringify(payload)],
  );
}

function isPool(db: Queryable): db is pg.Pool {
  return typeof (db as pg.Pool).connect === "function";
}

export async function openFacility(
  db: Queryable,
  input: OpenFacilityInput,
): Promise<CreditFacility> {
  if (!Number.isInteger(input.principalCents) || input.principalCents <= 0) {
    throw new Error(
      `principalCents must be a positive integer, got ${input.principalCents}`,
    );
  }
  const ltvBps = input.ltvBps ?? 9000;
  const locSpreadBps = input.locSpreadBps ?? 250;
  const now = input.now ?? new Date();

  const { rows: productRows } = await db.query(
    `SELECT id, term_months, rate_bps FROM cd_products WHERE id = $1`,
    [input.productId],
  );
  if (productRows.length === 0) {
    throw new Error(`cd_product ${input.productId} does not exist`);
  }
  const termMonths = productRows[0].term_months as number;
  const cdRateBps = productRows[0].rate_bps as number;

  const { rows: acctRows } = await db.query(
    `SELECT id, kind FROM accounts WHERE id = $1`,
    [input.accountId],
  );
  if (acctRows.length === 0) {
    throw new Error(`account ${input.accountId} does not exist`);
  }

  const maturityAt = new Date(now.getTime());
  maturityAt.setUTCMonth(maturityAt.getUTCMonth() + termMonths);

  const limitCents = Math.floor((input.principalCents * ltvBps) / 10_000);
  if (limitCents <= 0) {
    throw new Error(
      `LOC limit computed as ${limitCents}; increase principal or LTV`,
    );
  }
  const locRateBps = cdRateBps + locSpreadBps;
  const seriesId = `series_${randomUUID().replace(/-/g, "")}`;

  const run = async (q: Queryable): Promise<CreditFacility> => {
    const { rows: certRows } = await q.query(
      `INSERT INTO certificates
         (account_id, product_id, principal_cents, rate_bps, start_at, maturity_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pledged')
       RETURNING *`,
      [
        input.accountId,
        input.productId,
        input.principalCents,
        cdRateBps,
        now,
        maturityAt,
      ],
    );
    const certId = certRows[0].id as number;

    const { rows: facRows } = await q.query(
      `INSERT INTO credit_facilities
         (certificate_id, borrower_account_id, series_id, limit_cents, drawn_cents,
          holds_cents, rate_bps, ltv_bps, status, maturity_at, on_chain_supply_cents)
       VALUES ($1, $2, $3, $4, 0, 0, $5, $6, 'active', $7, $4)
       RETURNING *`,
      [
        certId,
        input.accountId,
        seriesId,
        limitCents,
        locRateBps,
        ltvBps,
        maturityAt,
      ],
    );
    const facility = rowToFacility(facRows[0]);
    await appendEvent(q, facility.id, "open", {
      principalCents: input.principalCents,
      limitCents,
      depositorWallet: input.depositorWallet,
      cdRateBps,
      locRateBps,
    });
    return facility;
  };

  if (isPool(db)) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const facility = await run(client);
      await client.query("COMMIT");
      return facility;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  return run(db);
}

export async function getFacility(
  db: Queryable,
  id: number,
): Promise<CreditFacility> {
  const { rows } = await db.query(
    `SELECT * FROM credit_facilities WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) throw new Error(`facility ${id} not found`);
  return rowToFacility(rows[0]);
}

export async function listFacilitiesByBorrower(
  db: Queryable,
  accountId: number,
): Promise<CreditFacility[]> {
  const { rows } = await db.query(
    `SELECT * FROM credit_facilities WHERE borrower_account_id = $1 ORDER BY id`,
    [accountId],
  );
  return rows.map(rowToFacility);
}

export async function requestPresentment(
  db: Queryable,
  input: RequestPresentmentInput,
): Promise<FacilityPresentment> {
  if (!input.cipRef || input.cipRef.trim() === "") {
    throw new Error("CIP required at cash-out");
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("amountCents must be a positive integer");
  }
  const facility = await getFacility(db, input.facilityId);
  if (facility.status !== "active" && facility.status !== "maturing") {
    throw new Error(
      `facility ${facility.id} not presentable (status=${facility.status})`,
    );
  }
  if (input.amountCents > facility.availableCents) {
    throw new Error(
      `amount ${input.amountCents} exceeds available ${facility.availableCents}`,
    );
  }

  const { rowCount } = await db.query(
    `UPDATE credit_facilities
     SET holds_cents = holds_cents + $2, updated_at = now()
     WHERE id = $1 AND limit_cents - drawn_cents - holds_cents >= $2`,
    [facility.id, input.amountCents],
  );
  if (rowCount !== 1) {
    throw new Error(
      `amount ${input.amountCents} exceeds available ${facility.availableCents}`,
    );
  }

  const { rows } = await db.query(
    `INSERT INTO facility_presentments
       (facility_id, amount_cents, presenter_wallet, presenter_name, cip_ref, status)
     VALUES ($1, $2, $3, $4, $5, 'requested')
     RETURNING *`,
    [
      input.facilityId,
      input.amountCents,
      input.presenterWallet,
      input.presenterName ?? "",
      input.cipRef,
    ],
  );
  await appendEvent(db, facility.id, "presentment_requested", {
    presentmentId: rows[0].id,
    amountCents: input.amountCents,
    presenterWallet: input.presenterWallet,
  });
  return rowToPresentment(rows[0]);
}

export async function drawAndPayPresentment(
  db: Queryable,
  presentmentId: number,
): Promise<FacilityPresentment> {
  const { rows: pRows } = await db.query(
    `SELECT * FROM facility_presentments WHERE id = $1`,
    [presentmentId],
  );
  if (pRows.length === 0) {
    throw new Error(`presentment ${presentmentId} not found`);
  }
  const p = pRows[0];
  if (p.status !== "requested") {
    throw new Error(
      `presentment ${presentmentId} status ${p.status}, expected requested`,
    );
  }
  const amount = Number(p.amount_cents);
  const facilityId = p.facility_id as number;

  const { rowCount } = await db.query(
    `UPDATE credit_facilities
     SET drawn_cents = drawn_cents + $2,
         holds_cents = holds_cents - $2,
         updated_at = now()
     WHERE id = $1
       AND holds_cents >= $2
       AND drawn_cents + $2 <= limit_cents`,
    [facilityId, amount],
  );
  if (rowCount !== 1) {
    throw new Error(`draw failed for presentment ${presentmentId}`);
  }
  const { rows } = await db.query(
    `UPDATE facility_presentments
     SET status = 'paid', draw_note = 'loc_draw', payout_note = 'presenter_paid',
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [presentmentId],
  );
  const facility = await getFacility(db, facilityId);
  await appendEvent(db, facilityId, "presentment_paid", {
    presentmentId,
    amountCents: amount,
    borrowerAccountId: facility.borrowerAccountId,
  });
  return rowToPresentment(rows[0]);
}

export async function markPresentmentBurned(
  db: Queryable,
  presentmentId: number,
  burnTxHash: string,
): Promise<FacilityPresentment> {
  const { rows: pRows } = await db.query(
    `SELECT * FROM facility_presentments WHERE id = $1`,
    [presentmentId],
  );
  if (pRows.length === 0) {
    throw new Error(`presentment ${presentmentId} not found`);
  }
  if (pRows[0].status !== "paid") {
    throw new Error(`burn requires paid status, got ${pRows[0].status}`);
  }
  const amount = Number(pRows[0].amount_cents);
  const facilityId = pRows[0].facility_id as number;
  const { rowCount } = await db.query(
    `UPDATE credit_facilities
     SET on_chain_supply_cents = on_chain_supply_cents - $2, updated_at = now()
     WHERE id = $1 AND on_chain_supply_cents >= $2`,
    [facilityId, amount],
  );
  if (rowCount !== 1) {
    throw new Error(
      `supply mirror decrease failed for presentment ${presentmentId}`,
    );
  }
  const { rows } = await db.query(
    `UPDATE facility_presentments
     SET status = 'burned', burn_tx_hash = $2, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [presentmentId, burnTxHash],
  );
  await appendEvent(db, facilityId, "presentment_burned", {
    presentmentId,
    burnTxHash,
    amountCents: amount,
  });
  return rowToPresentment(rows[0]);
}

export async function runMaturityWaterfall(
  db: Queryable,
  facilityId: number,
  opts?: { now?: Date },
): Promise<WaterfallResult> {
  const facility = await getFacility(db, facilityId);
  const { rows: certRows } = await db.query(
    `SELECT * FROM certificates WHERE id = $1`,
    [facility.certificateId],
  );
  if (certRows.length === 0) {
    throw new Error(`certificate ${facility.certificateId} not found`);
  }
  const principal = Number(certRows[0].principal_cents);
  const rateBps = certRows[0].rate_bps as number;
  const start = new Date(certRows[0].start_at);
  const maturity = new Date(certRows[0].maturity_at);
  const ms = Math.max(0, maturity.getTime() - start.getTime());
  const yearMs = 365.25 * 24 * 3600 * 1000;
  const cdInterest = Math.floor(
    (principal * rateBps * ms) / (10_000 * yearMs),
  );
  let proceeds = principal + cdInterest;

  const repaidLocCents = Math.min(facility.drawnCents, proceeds);
  proceeds -= repaidLocCents;

  const cdtFace = facility.onChainSupplyCents;
  const paidCdtHoldersCents = Math.min(cdtFace, proceeds);
  const proRata = paidCdtHoldersCents < cdtFace;
  proceeds -= paidCdtHoldersCents;
  const residualToDepositorCents = proceeds;

  await db.query(
    `UPDATE credit_facilities
     SET drawn_cents = 0, holds_cents = 0, on_chain_supply_cents = 0,
         status = 'closed', updated_at = now()
     WHERE id = $1`,
    [facilityId],
  );
  await db.query(
    `UPDATE certificates SET status = 'closed' WHERE id = $1`,
    [facility.certificateId],
  );
  await appendEvent(db, facilityId, "maturity_waterfall", {
    repaidLocCents,
    paidCdtHoldersCents,
    residualToDepositorCents,
    proRata,
    now: (opts?.now ?? new Date()).toISOString(),
  });
  const closed = await getFacility(db, facilityId);
  return {
    facility: closed,
    repaidLocCents,
    paidCdtHoldersCents,
    residualToDepositorCents,
    proRata,
  };
}

export async function reissueFacility(
  db: Queryable,
  input: ReissueInput,
): Promise<CreditFacility> {
  const facility = await getFacility(db, input.facilityId);
  if (facility.status !== "active" && facility.status !== "maturing") {
    throw new Error(`cannot reissue facility in status ${facility.status}`);
  }
  const { rows: certRows } = await db.query(
    `SELECT principal_cents, rate_bps FROM certificates WHERE id = $1`,
    [facility.certificateId],
  );
  const principal = Number(certRows[0].principal_cents);
  const cdRateBps = certRows[0].rate_bps as number;
  const ltvBps = input.newLtvBps ?? facility.ltvBps;
  const spread =
    input.newLocSpreadBps ?? Math.max(0, facility.rateBps - cdRateBps);
  const newLimit = Math.floor((principal * ltvBps) / 10_000);
  if (input.currentOnChainSupplyCents > newLimit) {
    throw new Error(
      `on-chain supply ${input.currentOnChainSupplyCents} exceeds new limit ${newLimit}; reduce float before reissue`,
    );
  }
  const now = input.now ?? new Date();
  const maturityAt = new Date(now.getTime());
  maturityAt.setUTCMonth(maturityAt.getUTCMonth() + input.newTermMonths);
  const locRate = cdRateBps + spread;

  await db.query(
    `UPDATE credit_facilities
     SET limit_cents = $2, ltv_bps = $3, rate_bps = $4, maturity_at = $5,
         on_chain_supply_cents = $6, status = 'active', updated_at = now()
     WHERE id = $1`,
    [
      facility.id,
      newLimit,
      ltvBps,
      locRate,
      maturityAt,
      input.currentOnChainSupplyCents,
    ],
  );
  await db.query(
    `UPDATE certificates SET maturity_at = $2, status = 'pledged' WHERE id = $1`,
    [facility.certificateId, maturityAt],
  );
  await appendEvent(db, facility.id, "reissue", {
    newLimit,
    maturityAt: maturityAt.toISOString(),
    supply: input.currentOnChainSupplyCents,
  });
  return getFacility(db, facility.id);
}

