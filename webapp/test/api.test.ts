/**
 * API tests against a dockerized Postgres with bank-sim's schema.
 *
 * Bring the database up first:
 *   docker compose -f test/docker-compose.yml up -d --wait
 * and tear it down afterwards:
 *   docker compose -f test/docker-compose.yml down -v
 */
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/server/app.js";
import {
  LOVELACE_PER_CENT,
  accrued,
  earlyPayout,
  fullInterest,
  lovelaceToCents,
  maturePayout,
} from "../src/server/math.js";
import type { AccountDto, CdDto, MemberDto, ProductDto } from "../src/shared/types.js";
import { ACTIVE_TX_HASH, seedFixture, type FixtureIds } from "./fixtures/seed.js";

const TEST_DB = {
  host: process.env.TEST_PGHOST || "127.0.0.1",
  port: Number(process.env.TEST_PGPORT || 55435),
  user: "bank",
  password: "bank",
  database: "bank_sim",
};

// Frozen clock so status derivation and projections are deterministic.
const NOW_MS = Date.UTC(2026, 5, 15, 12, 0, 0);

let pool: pg.Pool;
let app: Hono;
let fx: FixtureIds;

async function getJson<T>(path: string): Promise<{ status: number; body: T }> {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as T };
}

async function postJson<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

beforeAll(async () => {
  pool = new pg.Pool(TEST_DB);
  app = createApp({ pool, now: () => NOW_MS });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  fx = await seedFixture(pool, NOW_MS);
});

describe("GET /api/products", () => {
  it("lists the CD catalog with computed APY", async () => {
    const { status, body } = await getJson<ProductDto[]>("/api/products");
    expect(status).toBe(200);
    expect(body).toHaveLength(2);
    const [six, twelve] = body;
    expect(six).toMatchObject({
      name: "6-Month Share Certificate",
      termMonths: 6,
      rateBps: 400,
      apyPercent: 4,
      penaltyBps: 1000,
      minDepositCents: 50000,
    });
    expect(twelve!.apyPercent).toBeCloseTo(4.5);
    expect(twelve!.minDepositCents).toBe(100000);
  });
});

describe("GET /api/members", () => {
  it("lists distinct members for the demo picker", async () => {
    const { status, body } = await getJson<MemberDto[]>("/api/members");
    expect(status).toBe(200);
    expect(body.map((m) => m.memberName)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(body[0]!.id).toBe(fx.ada.memberId);
  });
});

describe("GET /api/members/:id/accounts", () => {
  it("returns the member's accounts with balances", async () => {
    const { status, body } = await getJson<AccountDto[]>(
      `/api/members/${fx.ada.memberId}/accounts`,
    );
    expect(status).toBe(200);
    expect(body).toHaveLength(2);
    const checking = body.find((a) => a.kind === "checking")!;
    const funding = body.find((a) => a.kind === "cd_funding")!;
    expect(checking.balanceCents).toBe(250_00);
    // 2500.00 active + 600.00 matured + 750.00 pending
    expect(funding.balanceCents).toBe(2_500_00 + 600_00 + 750_00);
  });

  it("resolves the member from any of their account ids", async () => {
    const viaFunding = await getJson<AccountDto[]>(`/api/members/${fx.ada.cdFundingId}/accounts`);
    expect(viaFunding.status).toBe(200);
    expect(viaFunding.body).toHaveLength(2);
  });

  it("404s for an unknown member", async () => {
    const { status } = await getJson(`/api/members/99999/accounts`);
    expect(status).toBe(404);
  });
});

describe("GET /api/members/:id/cds", () => {
  it("derives pending / active / matured status", async () => {
    const { status, body } = await getJson<CdDto[]>(`/api/members/${fx.ada.memberId}/cds`);
    expect(status).toBe(200);
    expect(body).toHaveLength(3);
    const byId = new Map(body.map((cd) => [cd.transactionId, cd]));
    expect(byId.get(fx.cds.activeTxId)!.status).toBe("active");
    expect(byId.get(fx.cds.maturedTxId)!.status).toBe("matured");
    expect(byId.get(fx.cds.pendingTxId)!.status).toBe("pending");
  });

  it("surfaces attestation terms, deposit id and tx hash", async () => {
    const { body } = await getJson<CdDto[]>(`/api/members/${fx.ada.memberId}/cds`);
    const active = body.find((cd) => cd.transactionId === fx.cds.activeTxId)!;
    expect(active.depositId).toBe(String(fx.cds.activeTxId));
    expect(active.startMs).toBe(fx.activePayload.start);
    expect(active.maturityMs).toBe(fx.activePayload.maturity);
    expect(active.rateBps).toBe(450);
    expect(active.penaltyBps).toBe(1000);
    expect(active.principalCents).toBe(2_500_00);
    expect(active.txHash).toBe(ACTIVE_TX_HASH);
    expect(active.explorerUrl).toContain(ACTIVE_TX_HASH);
    expect(active.projectionEstimated).toBe(false);

    const matured = body.find((cd) => cd.transactionId === fx.cds.maturedTxId)!;
    expect(matured.txHash).toBeNull();
    expect(matured.explorerUrl).toBeNull();
  });

  it("projects value today and at maturity with txlib math", async () => {
    const { body } = await getJson<CdDto[]>(`/api/members/${fx.ada.memberId}/cds`);
    const active = body.find((cd) => cd.transactionId === fx.cds.activeTxId)!;

    const p = fx.activePayload;
    const principal = BigInt(p.principal);
    const args = [principal, BigInt(p.rate_bps), BigInt(p.start), BigInt(p.maturity)] as const;
    const accruedNow = accrued(...args, BigInt(NOW_MS));
    expect(active.accruedTodayCents).toBe(lovelaceToCents(accruedNow));
    expect(active.valueTodayCents).toBe(lovelaceToCents(principal + accruedNow));
    expect(active.earlyPayoutTodayCents).toBe(
      lovelaceToCents(earlyPayout(...args, BigInt(p.penalty_bps), BigInt(NOW_MS))),
    );
    expect(active.maturityValueCents).toBe(lovelaceToCents(maturePayout(...args)));
    // Sanity: 2500 @ 4.5% over a year ≈ $112.50 interest.
    expect(active.maturityValueCents).toBeGreaterThan(2_610_00);
    expect(active.maturityValueCents).toBeLessThan(2_613_00);

    // Matured CD: accrual is clamped at maturity, so value today == maturity value.
    const matured = body.find((cd) => cd.transactionId === fx.cds.maturedTxId)!;
    expect(matured.valueTodayCents).toBe(matured.maturityValueCents);
  });

  it("returns an ascending payout curve for attested CDs when ?curve=1", async () => {
    const { body } = await getJson<CdDto[]>(`/api/members/${fx.ada.memberId}/cds?curve=1`);
    const active = body.find((cd) => cd.transactionId === fx.cds.activeTxId)!;
    expect(active.curve).not.toBeNull();
    const curve = active.curve!;
    expect(curve[0]!.tMs).toBe(fx.activePayload.start);
    expect(curve.at(-1)!.tMs).toBe(fx.activePayload.maturity);
    expect(curve[0]!.earlyPayoutCents).toBe(active.principalCents);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!.tMs).toBeGreaterThan(curve[i - 1]!.tMs);
      expect(curve[i]!.earlyPayoutCents).toBeGreaterThanOrEqual(curve[i - 1]!.earlyPayoutCents);
    }
    // Itemization is penny-consistent: principal + accrued − penalty == payout.
    for (const p of curve) {
      expect(active.principalCents + p.accruedCents - p.penaltyCents).toBe(p.earlyPayoutCents);
    }

    // Without ?curve=1 (the dashboard list) the curve is omitted.
    const { body: listBody } = await getJson<CdDto[]>(`/api/members/${fx.ada.memberId}/cds`);
    expect(listBody.every((cd) => cd.curve === null)).toBe(true);

    const pending = body.find((cd) => cd.transactionId === fx.cds.pendingTxId)!;
    expect(pending.curve).toBeNull();
    expect(pending.depositId).toBeNull();
    expect(pending.startMs).toBeNull();
    expect(pending.maturityMs).toBeNull();
    expect(pending.projectionEstimated).toBe(true);
    // Pending projections estimate with product terms: value grows by term end.
    expect(pending.maturityValueCents).toBeGreaterThan(pending.principalCents);
  });

  it("tolerates malformed attestation payloads without failing the list", async () => {
    // A fractional rate_bps must not make BigInt conversion throw (500).
    await pool.query(
      `UPDATE attestations SET payload = jsonb_set(payload, '{payload,rate_bps}', '450.7')
        WHERE transaction_id = $1`,
      [fx.cds.activeTxId],
    );
    const { status, body } = await getJson<CdDto[]>(`/api/members/${fx.ada.memberId}/cds`);
    expect(status).toBe(200);
    const active = body.find((cd) => cd.transactionId === fx.cds.activeTxId)!;
    expect(active.rateBps).toBe(450); // truncated, not thrown
    expect(active.status).toBe("active");
  });

  it("returns an empty list for a member without CDs", async () => {
    const { status, body } = await getJson<CdDto[]>(`/api/members/${fx.grace.memberId}/cds`);
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe("POST /api/members/:id/deposits", () => {
  it("opens a CD (writes a pending CD-funding deposit)", async () => {
    const { status, body } = await postJson<{ transactionId: number; status: string }>(
      `/api/members/${fx.grace.memberId}/deposits`,
      { productId: fx.products.twelveMonth, amountCents: 150_000 },
    );
    expect(status).toBe(201);
    expect(body.status).toBe("pending");

    // It lands in the member's CD list as pending, on the cd_funding account.
    const cds = await getJson<CdDto[]>(`/api/members/${fx.grace.memberId}/cds`);
    expect(cds.body).toHaveLength(1);
    expect(cds.body[0]!.transactionId).toBe(body.transactionId);
    expect(cds.body[0]!.status).toBe("pending");
    expect(cds.body[0]!.principalCents).toBe(150_000);

    const { rows } = await pool.query(
      `SELECT account_id, kind, product_id, attested FROM transactions WHERE id = $1`,
      [body.transactionId],
    );
    expect(rows[0]).toMatchObject({
      account_id: fx.grace.cdFundingId,
      kind: "deposit",
      product_id: fx.products.twelveMonth,
      attested: false,
    });
  });

  it("rejects a deposit below the product minimum", async () => {
    const { status, body } = await postJson<{ error: string }>(
      `/api/members/${fx.ada.memberId}/deposits`,
      { productId: fx.products.twelveMonth, amountCents: 999_99 },
    );
    expect(status).toBe(422);
    expect(body.error).toContain("minimum deposit");
  });

  it("rejects an unknown product", async () => {
    const { status } = await postJson(`/api/members/${fx.ada.memberId}/deposits`, {
      productId: 4242,
      amountCents: 100_000,
    });
    expect(status).toBe(404);
  });

  it("rejects invalid amounts", async () => {
    for (const amountCents of [0, -5, 10.5, "100000", null]) {
      const { status } = await postJson(`/api/members/${fx.ada.memberId}/deposits`, {
        productId: fx.products.sixMonth,
        amountCents,
      });
      expect(status).toBe(400);
    }
  });

  it("rejects amounts too large for the oracle to tokenize", async () => {
    // Above MAX_SAFE_INTEGER lovelace at the 1 cent = 10,000 lovelace peg.
    const { status, body } = await postJson<{ error: string }>(
      `/api/members/${fx.ada.memberId}/deposits`,
      { productId: fx.products.sixMonth, amountCents: 1_000_000_000_000_00 },
    );
    expect(status).toBe(422);
    expect(body.error).toContain("too large");
  });

  it("404s for an unknown member", async () => {
    const { status } = await postJson(`/api/members/99999/deposits`, {
      productId: fx.products.sixMonth,
      amountCents: 100_000,
    });
    expect(status).toBe(404);
  });
});

describe("GET /api/cds/:depositId/chain", () => {
  it("degrades gracefully when no chain provider is configured", async () => {
    const { status, body } = await getJson<{ available: boolean; reason?: string }>(
      `/api/cds/${fx.cds.activeTxId}/chain`,
    );
    expect(status).toBe(200);
    expect(body.available).toBe(false);
    expect(body.reason).toContain("CHAIN_PROVIDER");
  });

  it("reports unattested certificates as unavailable", async () => {
    const { status, body } = await getJson<{ available: boolean; reason?: string }>(
      `/api/cds/${fx.cds.pendingTxId}/chain`,
    );
    expect(status).toBe(200);
    expect(body.available).toBe(false);
    expect(body.reason).toContain("not attested");
  });

  it("queries koios when CHAIN_PROVIDER=koios-preview is set", async () => {
    const calls: { url: string; body: string }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), body: String(init?.body) });
      return new Response(JSON.stringify([{ tx_hash: ACTIVE_TX_HASH, block_height: 123 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const chainApp = createApp({
      pool,
      now: () => NOW_MS,
      chainProvider: "koios-preview",
      koiosBaseUrl: "https://koios.test/api/v1",
      fetchImpl,
    });
    const res = await chainApp.request(`/api/cds/${fx.cds.activeTxId}/chain`);
    const body = (await res.json()) as { available: boolean; txHash: string; tx: unknown };
    expect(body.available).toBe(true);
    expect(body.txHash).toBe(ACTIVE_TX_HASH);
    expect(calls[0]!.url).toBe("https://koios.test/api/v1/tx_info");
    expect(calls[0]!.body).toContain(ACTIVE_TX_HASH);

    // The matured CD has no tx hash: unavailable even with a provider.
    const noHash = await chainApp.request(`/api/cds/${fx.cds.maturedTxId}/chain`);
    const noHashBody = (await noHash.json()) as { available: boolean };
    expect(noHashBody.available).toBe(false);
  });
});

describe("interest math source", () => {
  it("uses txlib's exact constants (no reimplementation drift)", () => {
    // 1000.00 at 500 bps for exactly one Julian year = $50.00 interest.
    const principal = 1_000_00n * LOVELACE_PER_CENT;
    const interest = fullInterest(principal, 500n, 0n, 31_557_600_000n);
    expect(lovelaceToCents(interest)).toBe(50_00);
  });
});
