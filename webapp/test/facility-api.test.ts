/**
 * Credit-claim facility HTTP API.
 * Prereq: docker compose -f test/docker-compose.yml up -d --wait
 * (facility tables in fixtures/schema.sql)
 */
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/server/app.js";
import { seedFixture, type FixtureIds } from "./fixtures/seed.js";

const TEST_DB = {
  host: process.env.TEST_PGHOST || "127.0.0.1",
  port: Number(process.env.TEST_PGPORT || 55435),
  user: "bank",
  password: "bank",
  database: "bank_sim",
};

const NOW_MS = Date.UTC(2026, 5, 15, 12, 0, 0);

let pool: pg.Pool;
let app: Hono;
let fx: FixtureIds;

async function postJson<T>(
  path: string,
  body: unknown,
): Promise<{ status: number; body: T }> {
  const res = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

async function getJson<T>(path: string): Promise<{ status: number; body: T }> {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as T };
}

beforeAll(async () => {
  pool = new pg.Pool(TEST_DB);
  app = createApp({ pool, now: () => NOW_MS, allowOpenApi: true, apiKey: null });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  fx = await seedFixture(pool, NOW_MS);
});

type FacilityBody = {
  id: number;
  limitCents: number;
  drawnCents: number;
  availableCents: number;
  status: string;
  onChainSupplyCents: number;
  seriesId: string;
};

type PresentmentBody = {
  id: number;
  status: string;
  amountCents: number;
  burnTxHash: string | null;
};

describe("POST /api/facilities", () => {
  it("opens a facility with limit = 90% of principal", async () => {
    const { status, body } = await postJson<FacilityBody>("/api/facilities", {
      accountId: fx.ada.cdFundingId,
      productId: fx.products.sixMonth,
      principalCents: 10_000_00,
      depositorWallet: "addr_test1_depositor",
      ltvBps: 9000,
      locSpreadBps: 250,
    });
    expect(status).toBe(200);
    expect(body.limitCents).toBe(9_000_00);
    expect(body.status).toBe("active");
    expect(body.onChainSupplyCents).toBe(9_000_00);
    expect(body.seriesId).toMatch(/^series_/);

    const got = await getJson<FacilityBody>(`/api/facilities/${body.id}`);
    expect(got.status).toBe(200);
    expect(got.body.limitCents).toBe(9_000_00);
  });
});

describe("facility presentment cash-out", () => {
  it("draws depositor LOC then burns supply on complete path", async () => {
    const { body: facility } = await postJson<FacilityBody>("/api/facilities", {
      accountId: fx.ada.cdFundingId,
      productId: fx.products.sixMonth,
      principalCents: 10_000_00,
      depositorWallet: "addr_test1_dep",
      ltvBps: 9000,
    });

    const req = await postJson<PresentmentBody>(
      `/api/facilities/${facility.id}/presentments`,
      {
        amountCents: 1_000_00,
        presenterWallet: "addr_holder",
        presenterName: "Holder",
        cipRef: "cip-ok",
      },
    );
    expect(req.status).toBe(200);
    expect(req.body.status).toBe("requested");

    const paid = await postJson<PresentmentBody>(
      `/api/presentments/${req.body.id}/pay`,
      {},
    );
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe("paid");

    const mid = await getJson<FacilityBody>(`/api/facilities/${facility.id}`);
    expect(mid.body.drawnCents).toBe(1_000_00);
    expect(mid.body.availableCents).toBe(8_000_00);

    const burned = await postJson<PresentmentBody>(
      `/api/presentments/${req.body.id}/burn`,
      { burnTxHash: "tx_burn_demo" },
    );
    expect(burned.status).toBe(200);
    expect(burned.body.status).toBe("burned");

    const end = await getJson<FacilityBody>(`/api/facilities/${facility.id}`);
    expect(end.body.onChainSupplyCents).toBe(8_000_00);
  });

  it("rejects presentment without CIP", async () => {
    const { body: facility } = await postJson<FacilityBody>("/api/facilities", {
      accountId: fx.ada.cdFundingId,
      productId: fx.products.sixMonth,
      principalCents: 5_000_00,
      depositorWallet: "addr_test1_dep",
    });
    const res = await postJson<{ error: string }>(
      `/api/facilities/${facility.id}/presentments`,
      {
        amountCents: 100_00,
        presenterWallet: "addr_x",
        cipRef: "",
      },
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/CIP/i);
  });
});
