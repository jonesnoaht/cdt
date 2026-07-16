# CDT Credit-Claim Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework CDT so the primary product is a CD-collateralized bearer credit claim: core-led secured LOC, mint CDT = available credit, cash-out draws the original depositor’s LOC, coupon stays with the depositor, maturity waterfall + optional re-issue.

**Architecture:** CU core (`bank-sim`) is system of record for certificate, LOC, draws, waterfall, and re-issue. Cardano holds bearer CDT units (mint/burn/transfer). Oracle bridges: mint only to attested limit; burn only after core draw+pay. Multi-CU network is out of scope (phase 2).

**Tech Stack:** TypeScript (Node ≥22), Postgres + `pg`, Vitest, Hono webapp API, React + Vite UI, Aiken/Plutus mint policy, existing `@cdt/cdt-txlib` / oracle-watcher patterns.

**Spec:** `docs/superpowers/specs/2026-07-16-cdt-credit-claim-design.md`

## Global Constraints

- **Liability:** Presenter is never the borrower; draws always hit original depositor’s facility.
- **Coupon:** Accrues to depositor on full pledged CD principal; never to CDT holders.
- **Mint:** At open, `CDT_supply = facility.limit` (e.g. LTV × principal); units are integer minor units (cents).
- **Invariant:** `on_chain_supply ≤ facility.limit` and `drawn + available + holds = limit`.
- **Maturity:** Default waterfall B; re-issue only with dual opt-in and `supply ≤ new_limit`.
- **Bearer free-spend:** Native asset transfers permissionless; CIP/OFAC at cash-out only (stub in demo).
- **Core wins:** On draw/burn desync, core is authoritative; halt mints until reconciled.
- **No PII on-chain.**
- **Legacy:** `cd_vault` interest redeem is not the primary product path; quarantine from primary UI/docs.
- **Not legal advice;** pilot caps only in sim defaults (LTV 90%, LOC = CD rate + 250 bps).

---

## File map (create / modify)

| Path | Responsibility |
|---|---|
| `bank-sim/schema.sql` | Tables: `certificates`, `credit_facilities`, `facility_presentments`, `facility_events` |
| `bank-sim/src/types.ts` | Facility domain types |
| `bank-sim/src/facility.ts` | open / draw / complete / waterfall / reissue pure core ops |
| `bank-sim/src/index.ts` | Re-export facility API |
| `bank-sim/test/facility.test.ts` | Core economics + invariants |
| `bank-sim/scripts/apply-schema.ts` | Already applies schema.sql — no API change |
| `offchain/pipeline/` or `bank-sim` mock ledger | Optional in-memory chain ledger for S2 |
| `onchain/validators/cdt_claim_mint.ak` (or evolve `cdt_mint.ak`) | Mint/burn credit units without vault interest lock |
| `offchain/cdt-txlib/src/claim-builders.ts` | Mint full limit, burn on presentment |
| `offchain/oracle-watcher/src/facility-watcher.ts` | Poll facilities; mint/burn attestations |
| `webapp/src/server/facility-routes.ts` | HTTP open / present / reissue / waterfall |
| `webapp/src/ui/*` | Open facility, present desk, issuer ops |
| `docs/product-position.md`, `README.md` | Credit-claim product sentence |
| `offchain/demo/` | E2E open → transfer → present → maturity |

---

### Task 1: bank-sim schema + facility domain types

**Files:**
- Modify: `bank-sim/schema.sql`
- Modify: `bank-sim/src/types.ts`
- Modify: `bank-sim/src/index.ts` (export new types only)
- Test: `bank-sim/test/facility.test.ts` (types/schema smoke via open later in Task 2; this task adds schema + types + apply)

**Interfaces:**
- Produces: `Certificate`, `CreditFacility`, `FacilityPresentment`, `FacilityStatus`, `PresentmentStatus` types; SQL tables ready for Task 2.

- [ ] **Step 1: Append facility tables to `bank-sim/schema.sql`**

Add after existing tables (keep legacy `presentments` for settlement network; new table is `facility_presentments`):

```sql
-- Credit-claim product (2026-07-16 design): CD + secured LOC + CDT claim units.

CREATE TABLE IF NOT EXISTS certificates (
  id SERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id),
  product_id INT NOT NULL REFERENCES cd_products(id),
  principal_cents BIGINT NOT NULL CHECK (principal_cents > 0),
  rate_bps INT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  maturity_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'pledged', 'matured', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_facilities (
  id SERIAL PRIMARY KEY,
  certificate_id INT NOT NULL UNIQUE REFERENCES certificates(id),
  borrower_account_id INT NOT NULL REFERENCES accounts(id),
  series_id TEXT NOT NULL UNIQUE,
  limit_cents BIGINT NOT NULL CHECK (limit_cents > 0),
  drawn_cents BIGINT NOT NULL DEFAULT 0 CHECK (drawn_cents >= 0),
  holds_cents BIGINT NOT NULL DEFAULT 0 CHECK (holds_cents >= 0),
  rate_bps INT NOT NULL,
  ltv_bps INT NOT NULL CHECK (ltv_bps > 0 AND ltv_bps <= 10000),
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'active', 'maturing', 'default', 'closed'
  )),
  maturity_at TIMESTAMPTZ NOT NULL,
  on_chain_supply_cents BIGINT NOT NULL DEFAULT 0 CHECK (on_chain_supply_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (drawn_cents + holds_cents <= limit_cents)
);

CREATE INDEX IF NOT EXISTS idx_credit_facilities_status
  ON credit_facilities (status);
CREATE INDEX IF NOT EXISTS idx_credit_facilities_borrower
  ON credit_facilities (borrower_account_id);

CREATE TABLE IF NOT EXISTS facility_presentments (
  id SERIAL PRIMARY KEY,
  facility_id INT NOT NULL REFERENCES credit_facilities(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  presenter_wallet TEXT NOT NULL,
  presenter_name TEXT NOT NULL DEFAULT '',
  cip_ref TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN (
    'requested', 'drawn', 'paid', 'burned', 'failed', 'reconciled'
  )),
  draw_note TEXT,
  payout_note TEXT,
  burn_tx_hash TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facility_presentments_facility
  ON facility_presentments (facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_presentments_status
  ON facility_presentments (status);

CREATE TABLE IF NOT EXISTS facility_events (
  id SERIAL PRIMARY KEY,
  facility_id INT NOT NULL REFERENCES credit_facilities(id),
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facility_events_facility
  ON facility_events (facility_id);
```

- [ ] **Step 2: Add types to `bank-sim/src/types.ts`**

```typescript
export type CertificateStatus = "open" | "pledged" | "matured" | "closed";
export type FacilityStatus =
  | "pending"
  | "active"
  | "maturing"
  | "default"
  | "closed";
export type FacilityPresentmentStatus =
  | "requested"
  | "drawn"
  | "paid"
  | "burned"
  | "failed"
  | "reconciled";

export interface Certificate {
  id: number;
  accountId: number;
  productId: number;
  principalCents: number;
  rateBps: number;
  startAt: Date;
  maturityAt: Date;
  status: CertificateStatus;
  createdAt: Date;
}

export interface CreditFacility {
  id: number;
  certificateId: number;
  borrowerAccountId: number;
  seriesId: string;
  limitCents: number;
  drawnCents: number;
  holdsCents: number;
  /** limit - drawn - holds */
  availableCents: number;
  rateBps: number;
  ltvBps: number;
  status: FacilityStatus;
  maturityAt: Date;
  /** Mirror of CDT supply for reconcile (core view). */
  onChainSupplyCents: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpenFacilityInput {
  accountId: number;
  productId: number;
  principalCents: number;
  /** Default 9000 = 90%. */
  ltvBps?: number;
  /** LOC spread over CD rate; default 250. */
  locSpreadBps?: number;
  /** Depositor wallet that will receive minted CDT. */
  depositorWallet: string;
  /** Optional fixed clock for tests. */
  now?: Date;
}

export interface FacilityPresentment {
  id: number;
  facilityId: number;
  amountCents: number;
  presenterWallet: string;
  presenterName: string;
  cipRef: string;
  status: FacilityPresentmentStatus;
  burnTxHash: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RequestPresentmentInput {
  facilityId: number;
  amountCents: number;
  presenterWallet: string;
  presenterName?: string;
  /** Demo CIP stub: non-empty means pass. */
  cipRef: string;
}

export interface WaterfallResult {
  facility: CreditFacility;
  repaidLocCents: number;
  paidCdtHoldersCents: number;
  residualToDepositorCents: number;
  proRata: boolean;
}

export interface ReissueInput {
  facilityId: number;
  newTermMonths: number;
  newLtvBps?: number;
  newLocSpreadBps?: number;
  /** Must reflect current on-chain supply; reject if > new limit. */
  currentOnChainSupplyCents: number;
  now?: Date;
}
```

- [ ] **Step 3: Export types from `bank-sim/src/index.ts`**

```typescript
export type {
  // ...existing...
  Certificate,
  CertificateStatus,
  CreditFacility,
  FacilityStatus,
  FacilityPresentment,
  FacilityPresentmentStatus,
  OpenFacilityInput,
  RequestPresentmentInput,
  WaterfallResult,
  ReissueInput,
} from "./types.js";
```

- [ ] **Step 4: Apply schema**

Run:

```bash
cd bank-sim && npm run db:up && npm run db:apply
```

Expected: exit 0; tables exist:

```bash
docker compose exec -T db psql -U cdt -d cdt -c '\dt'
```

(Use the compose service/user/db names from `bank-sim/docker-compose.yml` if different.)

- [ ] **Step 5: Commit**

```bash
git add bank-sim/schema.sql bank-sim/src/types.ts bank-sim/src/index.ts
git commit -m "feat(bank-sim): schema and types for CD credit facilities"
```

---

### Task 2: openFacility + available math (TDD)

**Files:**
- Create: `bank-sim/src/facility.ts`
- Modify: `bank-sim/src/index.ts`
- Test: `bank-sim/test/facility.test.ts`

**Interfaces:**
- Consumes: Task 1 types + `Queryable` from `db.ts`, existing `accounts` / `cd_products`
- Produces:
  - `availableCents(f): number`
  - `openFacility(db, input): Promise<CreditFacility>`
  - `getFacility(db, id): Promise<CreditFacility>`
  - `listFacilitiesByBorrower(db, accountId): Promise<CreditFacility[]>`

- [ ] **Step 1: Write failing tests in `bank-sim/test/facility.test.ts`**

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool } from "../src/db.js";
import { seed, type SeedResult } from "../src/seed.js";
import {
  openFacility,
  getFacility,
  availableCents,
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

describe("openFacility", () => {
  it("books pledged CD + LOC and sets limit = LTV * principal", async () => {
    const now = new Date("2026-07-16T12:00:00Z");
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
    expect(facility.onChainSupplyCents).toBe(9_000_00); // mint = full limit (core mirror)
    expect(facility.rateBps).toBeGreaterThan(0);
    const again = await getFacility(pool, facility.id);
    expect(again.seriesId).toBe(facility.seriesId);
    expect(availableCents(again)).toBe(9_000_00);
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
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd bank-sim && npm test -- test/facility.test.ts
```

Expected: FAIL (module `facility.js` not found or exports missing).

- [ ] **Step 3: Implement `bank-sim/src/facility.ts` (open + get)**

```typescript
import { randomUUID } from "node:crypto";
import type { Queryable } from "./db.js";
import type {
  CreditFacility,
  OpenFacilityInput,
  Certificate,
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

async function appendEvent(
  db: Queryable,
  facilityId: number,
  kind: string,
  payload: unknown,
): Promise<void> {
  await db.query(
    `INSERT INTO facility_events (facility_id, kind, payload) VALUES ($1, $2, $3)`,
    [facilityId, kind, JSON.stringify(payload)],
  );
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
    `SELECT id FROM accounts WHERE id = $1`,
    [input.accountId],
  );
  if (acctRows.length === 0) {
    throw new Error(`account ${input.accountId} does not exist`);
  }

  const maturityAt = new Date(now);
  maturityAt.setUTCMonth(maturityAt.getUTCMonth() + termMonths);

  const limitCents = Math.floor((input.principalCents * ltvBps) / 10_000);
  if (limitCents <= 0) {
    throw new Error(`LOC limit computed as ${limitCents}; increase principal or LTV`);
  }
  const locRateBps = cdRateBps + locSpreadBps;
  const seriesId = `series_${randomUUID().replace(/-/g, "")}`;

  // Single transaction: certificate + facility + event
  const client =
    "query" in db && "connect" in (db as object)
      ? await (db as import("pg").Pool).connect()
      : null;

  const q: Queryable = client ?? db;
  try {
    if (client) await client.query("BEGIN");

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

    if (client) await client.query("COMMIT");
    return facility;
  } catch (e) {
    if (client) await client.query("ROLLBACK");
    throw e;
  } finally {
    client?.release();
  }
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
```

Note: If `Queryable` is only `Pool | PoolClient` without `connect`, use `pool.connect()` only when `db` is a Pool — match patterns already used in bank-sim; simplify to sequential inserts without BEGIN if the codebase does not use multi-query transactions yet (still correct for single-threaded tests).

- [ ] **Step 4: Export from `index.ts` and run tests**

```bash
cd bank-sim && npm test -- test/facility.test.ts
```

Expected: PASS for openFacility cases.

- [ ] **Step 5: Commit**

```bash
git add bank-sim/src/facility.ts bank-sim/src/index.ts bank-sim/test/facility.test.ts
git commit -m "feat(bank-sim): openFacility books pledged CD and secured LOC"
```

---

### Task 3: presentment draw / pay / burn mirror (core path)

**Files:**
- Modify: `bank-sim/src/facility.ts`
- Modify: `bank-sim/test/facility.test.ts`

**Interfaces:**
- Produces:
  - `requestPresentment(db, input): Promise<FacilityPresentment>` — CIP stub required
  - `drawAndPayPresentment(db, presentmentId): Promise<FacilityPresentment>` — increases `drawn`, status `paid` (core money movement)
  - `markPresentmentBurned(db, presentmentId, burnTxHash): Promise<FacilityPresentment>` — decreases `on_chain_supply_cents`
  - `failPresentment(db, presentmentId, reason): Promise<FacilityPresentment>`

**Rules:**
- `amount > available` → throw, no state change
- Empty `cipRef` → throw (`CIP required`)
- Draw hits **borrower** facility only (no presenter loan row)
- Certificate principal unchanged
- After burn mark: `on_chain_supply_cents -= amount`

- [ ] **Step 1: Write failing tests**

```typescript
describe("presentment cash-out", () => {
  it("draws depositor LOC and reduces supply mirror on burn", async () => {
    const facility = await openFacility(pool, {
      accountId: seeded.cdFundingIds[1]!,
      productId: seeded.productIds[0]!,
      principalCents: 10_000_00,
      ltvBps: 9000,
      depositorWallet: "addr_dep",
      now: new Date("2026-07-16T12:00:00Z"),
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
    // CD principal still full — load certificate
    const { rows } = await pool.query(
      `SELECT principal_cents, status FROM certificates WHERE id = $1`,
      [facility.certificateId],
    );
    expect(Number(rows[0].principal_cents)).toBe(10_000_00);
    expect(rows[0].status).toBe("pledged");

    const burned = await markPresentmentBurned(pool, p.id, "tx_burn_abc");
    expect(burned.status).toBe("burned");
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
      accountId: seeded.checkingIds[0]!,
      productId: seeded.productIds[1]!,
      principalCents: 5_000_00,
      depositorWallet: "addr_dep3",
    });
    // use a dedicated facility open on cd funding if checking not allowed —
    // openFacility should require any valid account; if you restrict to cd_funding, use seeded.cdFundingIds and unique product/principal
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
```

Fix the third test to open on an account that works if you constrain `openFacility` to `cd_funding` only (recommended): add check `accounts.kind === 'cd_funding'` in openFacility and always use `seeded.cdFundingIds`.

- [ ] **Step 2: Run — expect FAIL** (functions missing)

- [ ] **Step 3: Implement presentment functions in `facility.ts`**

```typescript
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
    throw new Error(`facility ${facility.id} not presentable (status=${facility.status})`);
  }
  if (input.amountCents > facility.availableCents) {
    throw new Error(
      `amount ${input.amountCents} exceeds available ${facility.availableCents}`,
    );
  }
  // Optional: place hold
  await db.query(
    `UPDATE credit_facilities
     SET holds_cents = holds_cents + $2, updated_at = now()
     WHERE id = $1 AND limit_cents - drawn_cents - holds_cents >= $2`,
    [facility.id, input.amountCents],
  );
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
  if (pRows.length === 0) throw new Error(`presentment ${presentmentId} not found`);
  const p = pRows[0];
  if (p.status !== "requested") {
    throw new Error(`presentment ${presentmentId} status ${p.status}, expected requested`);
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
  await appendEvent(db, facilityId, "presentment_paid", {
    presentmentId,
    amountCents: amount,
    borrowerAccountId: (await getFacility(db, facilityId)).borrowerAccountId,
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
  if (pRows.length === 0) throw new Error(`presentment ${presentmentId} not found`);
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
    throw new Error(`supply mirror decrease failed for presentment ${presentmentId}`);
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
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd bank-sim && npm test -- test/facility.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add bank-sim/src/facility.ts bank-sim/test/facility.test.ts bank-sim/src/index.ts
git commit -m "feat(bank-sim): facility presentment draws depositor LOC"
```

---

### Task 4: maturity waterfall + re-issue

**Files:**
- Modify: `bank-sim/src/facility.ts`
- Modify: `bank-sim/test/facility.test.ts`

**Interfaces:**
- Produces:
  - `runMaturityWaterfall(db, facilityId, opts?: { now?: Date }): Promise<WaterfallResult>`
  - `reissueFacility(db, input: ReissueInput): Promise<CreditFacility>`

**Waterfall order (spec):**
1. Repay drawn LOC from CD proceeds (principal + simple CD interest for sim).
2. Pay remaining CDT face (`on_chain_supply_cents`) pro rata if short.
3. Residual to depositor.
4. Set facility `closed`, certificate `closed`/`matured`, `on_chain_supply_cents = 0`, `drawn_cents = 0`.

**Re-issue:**
- Require `status` active or maturing; `currentOnChainSupplyCents ≤ new_limit` else throw.
- Update maturity, limit, rates; keep series_id or append event `reissue` with new maturity pin.
- Set `on_chain_supply_cents` unchanged if ≤ new limit.

- [ ] **Step 1: Failing tests**

```typescript
describe("maturity waterfall", () => {
  it("repays LOC then clears CDT supply mirror", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
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
      now: new Date("2027-01-01T00:00:00Z"),
    });
    expect(result.repaidLocCents).toBe(2_000_00);
    expect(result.facility.status).toBe("closed");
    expect(result.facility.drawnCents).toBe(0);
    expect(result.facility.onChainSupplyCents).toBe(0);
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
    });
    const re = await reissueFacility(pool, {
      facilityId: facility.id,
      newTermMonths: 12,
      currentOnChainSupplyCents: facility.onChainSupplyCents,
      now: new Date("2026-08-01T00:00:00Z"),
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
        newLtvBps: 1000, // 10% → much smaller limit
        currentOnChainSupplyCents: facility.onChainSupplyCents,
      }),
    ).rejects.toThrow(/supply/i);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement waterfall + reissue**

```typescript
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
  const principal = Number(certRows[0].principal_cents);
  const rateBps = certRows[0].rate_bps as number;
  const start = new Date(certRows[0].start_at);
  const maturity = new Date(certRows[0].maturity_at);
  const ms = Math.max(0, maturity.getTime() - start.getTime());
  const yearMs = 365.25 * 24 * 3600 * 1000;
  const cdInterest = Math.floor((principal * rateBps * ms) / (10_000 * yearMs));
  let proceeds = principal + cdInterest;

  const repaidLocCents = Math.min(facility.drawnCents, proceeds);
  proceeds -= repaidLocCents;

  const cdtFace = facility.onChainSupplyCents;
  let paidCdtHoldersCents = Math.min(cdtFace, proceeds);
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
  const spread = input.newLocSpreadBps ?? facility.rateBps - cdRateBps;
  const newLimit = Math.floor((principal * ltvBps) / 10_000);
  if (input.currentOnChainSupplyCents > newLimit) {
    throw new Error(
      `on-chain supply ${input.currentOnChainSupplyCents} exceeds new limit ${newLimit}; reduce float before reissue`,
    );
  }
  const now = input.now ?? new Date();
  const maturityAt = new Date(now);
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
```

- [ ] **Step 4: Run tests — PASS**

```bash
cd bank-sim && npm test -- test/facility.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add bank-sim/src/facility.ts bank-sim/test/facility.test.ts bank-sim/src/index.ts
git commit -m "feat(bank-sim): maturity waterfall and optional facility reissue"
```

---

### Task 5: Issuer HTTP API (webapp server) for facilities

**Files:**
- Create: `webapp/src/server/facility-routes.ts`
- Modify: `webapp/src/server/app.ts` (mount routes)
- Test: `webapp/test/facility-api.test.ts` (or extend existing server tests)

**Interfaces:**
- `POST /api/facilities` body: `{ accountId, productId, principalCents, depositorWallet, ltvBps?, locSpreadBps? }` → facility JSON
- `GET /api/facilities/:id`
- `POST /api/facilities/:id/presentments` body: `{ amountCents, presenterWallet, presenterName?, cipRef }`
- `POST /api/presentments/:id/complete` body: `{ burnTxHash }` — calls drawAndPay if still requested, then mark burned (or split endpoints)
- `POST /api/facilities/:id/waterfall`
- `POST /api/facilities/:id/reissue` body: `{ newTermMonths, currentOnChainSupplyCents, newLtvBps? }`

Prefer two-step complete for desync testing:
1. `POST .../presentments/:id/pay` → `drawAndPayPresentment`
2. `POST .../presentments/:id/burn` → `markPresentmentBurned`

- [ ] **Step 1: Write API test that opens facility and presents**

Use whatever HTTP test style the webapp already uses (fetch against app with test pool). Minimal:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
// wire createApp + pool + seed like other webapp tests

describe("facility API", () => {
  it("POST /api/facilities returns limit = 90% principal", async () => {
    const res = await app.request("/api/facilities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: seededCdFundingId,
        productId: seededProductId,
        principalCents: 10_000_00,
        depositorWallet: "addr_test_dep",
        ltvBps: 9000,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limitCents).toBe(9_000_00);
    expect(body.status).toBe("active");
  });
});
```

- [ ] **Step 2: Run — FAIL (404)**

- [ ] **Step 3: Implement `facility-routes.ts` with Hono**

```typescript
import { Hono } from "hono";
import type pg from "pg";
import {
  openFacility,
  getFacility,
  requestPresentment,
  drawAndPayPresentment,
  markPresentmentBurned,
  runMaturityWaterfall,
  reissueFacility,
} from "../../../bank-sim/src/facility.js"; // or package import if workspace-linked

export function facilityRoutes(pool: pg.Pool): Hono {
  const r = new Hono();

  r.post("/facilities", async (c) => {
    const body = await c.req.json();
    const facility = await openFacility(pool, {
      accountId: Number(body.accountId),
      productId: Number(body.productId),
      principalCents: Number(body.principalCents),
      depositorWallet: String(body.depositorWallet),
      ltvBps: body.ltvBps != null ? Number(body.ltvBps) : undefined,
      locSpreadBps: body.locSpreadBps != null ? Number(body.locSpreadBps) : undefined,
    });
    return c.json(facility);
  });

  r.get("/facilities/:id", async (c) => {
    const facility = await getFacility(pool, Number(c.req.param("id")));
    return c.json(facility);
  });

  r.post("/facilities/:id/presentments", async (c) => {
    const body = await c.req.json();
    const p = await requestPresentment(pool, {
      facilityId: Number(c.req.param("id")),
      amountCents: Number(body.amountCents),
      presenterWallet: String(body.presenterWallet),
      presenterName: body.presenterName,
      cipRef: String(body.cipRef ?? ""),
    });
    return c.json(p);
  });

  r.post("/presentments/:id/pay", async (c) => {
    const p = await drawAndPayPresentment(pool, Number(c.req.param("id")));
    return c.json(p);
  });

  r.post("/presentments/:id/burn", async (c) => {
    const body = await c.req.json();
    const p = await markPresentmentBurned(
      pool,
      Number(c.req.param("id")),
      String(body.burnTxHash),
    );
    return c.json(p);
  });

  r.post("/facilities/:id/waterfall", async (c) => {
    const result = await runMaturityWaterfall(pool, Number(c.req.param("id")));
    return c.json(result);
  });

  r.post("/facilities/:id/reissue", async (c) => {
    const body = await c.req.json();
    const facility = await reissueFacility(pool, {
      facilityId: Number(c.req.param("id")),
      newTermMonths: Number(body.newTermMonths),
      currentOnChainSupplyCents: Number(body.currentOnChainSupplyCents),
      newLtvBps: body.newLtvBps != null ? Number(body.newLtvBps) : undefined,
    });
    return c.json(facility);
  });

  return r;
}
```

Mount under `/api` in `createApp`. If bank-sim is not imported from webapp yet, add workspace dependency or duplicate a thin server-side wrapper that uses the same SQL — prefer depending on `@cdt/bank-sim` via relative import consistent with monorepo.

- [ ] **Step 4: Tests PASS**

```bash
cd webapp && npm test -- test/facility-api.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add webapp/src/server/facility-routes.ts webapp/src/server/app.ts webapp/test/facility-api.test.ts
git commit -m "feat(webapp): HTTP API for credit facilities and presentments"
```

---

### Task 6: On-chain claim mint/burn + txlib (no interest vault)

**Files:**
- Create or modify: `onchain/validators/cdt_claim_mint.ak` (recommended new validator to avoid breaking legacy demos)
- Modify: `onchain/aiken.toml` / package as needed
- Create: `offchain/cdt-txlib/src/claim-builders.ts`
- Modify: `offchain/cdt-txlib/src/index.ts`
- Test: `offchain/cdt-txlib/test/claim-builders.test.ts` (unit encode/plan; emulator if project already has it)

**On-chain rules (v1 minimal):**
- Parameterized by `oracle_vkh`
- Redeemer `MintClaim { series_id, amount, maturity }` — oracle signature required; mint `amount` tokens named `series_id` (or hash); no vault interest output required
- Redeemer `BurnClaim` — permissionless burn (presentment finalize)
- Optional datum registry for maturity/limit later; v1 may keep limit only off-chain with oracle discipline

- [ ] **Step 1: Write Aiken validator skeleton + `aiken check`**

```aiken
//// cdt_claim_mint: mint/burn bearer credit-claim units (no interest vault).
//// MintClaim requires oracle co-sign; BurnClaim is permissionless.

use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}

pub type ClaimRedeemer {
  MintClaim { series_id: ByteArray, amount: Int, maturity: Int }
  BurnClaim
}

validator cdt_claim_mint(oracle_vkh: VerificationKeyHash) {
  mint(redeemer: ClaimRedeemer, policy_id: PolicyId, self: Transaction) {
    let own_mint = assets.tokens(self.mint, policy_id) |> dict.to_pairs
    when redeemer is {
      MintClaim { series_id, amount, maturity } -> and {
          list.has(self.extra_signatories, oracle_vkh),
          amount > 0,
          maturity > 0,
          own_mint == [Pair(series_id, amount)],
        }
      BurnClaim ->
        // Only negative mints (burns); no positive mint in same redeemer path.
        list.all(own_mint, fn(p) { p.2nd < 0 })
    }
  }
}
```

(Adjust imports to match installed Aiken stdlib version in repo.)

- [ ] **Step 2: `cd onchain && aiken check`** — expect PASS

- [ ] **Step 3: txlib claim builders**

```typescript
// claim-builders.ts — plan mint of `amount` to depositor; burn `amount` from holder
export type ClaimMintPlan = {
  seriesIdHex: string;
  amount: bigint;
  maturity: number;
  recipientBech32: string;
};

export function assertClaimMintAmount(amount: bigint, limit: bigint): void {
  if (amount <= 0n) throw new Error("mint amount must be positive");
  if (amount > limit) throw new Error("mint amount exceeds facility limit");
}
```

Add tests for `assertClaimMintAmount` and any CBOR/helper used.

- [ ] **Step 4: Commit**

```bash
git add onchain/ offchain/cdt-txlib/
git commit -m "feat(onchain): claim mint policy without interest vault"
```

---

### Task 7: Oracle facility watcher + reconcile

**Files:**
- Create: `offchain/oracle-watcher/src/facility-watcher.ts`
- Modify: `offchain/oracle-watcher/src/cli.ts` or `index.ts` to run facility mode
- Test: `offchain/oracle-watcher/test/facility-watcher.test.ts` (mock db + mock chain)

**Behavior:**
1. Poll `credit_facilities` where `status = 'active'` and mint not yet submitted (track `facility_events` kind `mint_submitted` or `on_chain_supply` vs chain).
2. For new open: build claim mint tx for `limit_cents`, oracle-sign, submit; append event `mint_submitted`.
3. For presentments `paid` without `burn_tx_hash`: build burn, submit, call `markPresentmentBurned`.
4. Reconcile job: if chain supply (mocked) > limit → set facility pause flag via event `reconcile_halt` and refuse new mints.

- [ ] **Step 1: Test — paid presentment triggers burn mark when watcher runs once**

- [ ] **Step 2: Implement watcher loop (single tick function `tickFacilityWatcher(deps)`)**

```typescript
export type FacilityWatcherDeps = {
  pool: Queryable;
  listPaidUnburned: () => Promise<{ id: number; amountCents: number; seriesId: string }[]>;
  burnOnChain: (p: { id: number; amountCents: number; seriesId: string }) => Promise<string>;
  markBurned: (id: number, txHash: string) => Promise<void>;
};

export async function tickBurns(deps: FacilityWatcherDeps): Promise<number> {
  const due = await deps.listPaidUnburned();
  for (const p of due) {
    const txHash = await deps.burnOnChain(p);
    await deps.markBurned(p.id, txHash);
  }
  return due.length;
}
```

- [ ] **Step 3: Unit test with mocks — PASS**

- [ ] **Step 4: Commit**

```bash
git add offchain/oracle-watcher/
git commit -m "feat(oracle): facility mint/burn watcher and reconcile halt"
```

---

### Task 8: Webapp UI — open, present, issuer ops

**Files:**
- Create: `webapp/src/ui/OpenFacility.tsx` (or repurpose `OpenCd` flow)
- Create: `webapp/src/ui/PresentFacility.tsx`
- Create: `webapp/src/ui/FacilityOps.tsx` (waterfall / reissue)
- Modify: router / nav copy
- Modify: `docs/product-position.md`, root `README.md` primary product sentence

**UI copy (required):**
- Open: “You keep the certificate coupon. CDT lets others draw your secured line.”
- Present: “You receive cash/credit. You are not borrowing. Depositor’s LOC is drawn.”
- No “holder earns interest” strings in primary flows.

- [ ] **Step 1: OpenFacility form posts to `/api/facilities`, shows limit and seriesId**

- [ ] **Step 2: PresentFacility form: amount, presenter wallet, CIP checkbox → request → pay → burn (burn may be oracle-automated; button “Complete cash-out” calls pay then burn with mock hash in demo)**

- [ ] **Step 3: FacilityOps: buttons Waterfall / Reissue with confirm**

- [ ] **Step 4: Manual smoke**

```bash
cd webapp && npm run dev
# Open facility → note limit → present partial → facility drawn increases
```

- [ ] **Step 5: Commit**

```bash
git add webapp/src/ui webapp/src/server docs/product-position.md README.md
git commit -m "feat(webapp): credit-claim open and presentment UI"
```

---

### Task 9: E2E demo script + docs alignment + legacy quarantine

**Files:**
- Create: `offchain/demo/src/credit-claim-lifecycle.ts`
- Modify: `offchain/demo/README.md`
- Modify: `docs/whitepaper.md` (summary section pointing at new primary product)
- Modify: `docs/compliance.md` (note transferability posture change + cash-out CIP)
- Quarantine: mark vault redeem routes as `legacy` in UI nav or README

**Demo steps script must print:**
1. open facility  
2. “transfer” (log second wallet — chain transfer or simulated supply still with holder)  
3. present → pay → burn  
4. assert core: principal unchanged, drawn = X, supply mirror down  
5. waterfall → closed  

- [ ] **Step 1: Implement lifecycle script using bank-sim APIs (+ mock burn hashes if chain not up)**

- [ ] **Step 2: Run**

```bash
cd offchain/demo && npx tsx src/credit-claim-lifecycle.ts
```

Expected: exit 0; prints `OK credit-claim lifecycle`.

- [ ] **Step 3: Update docs product sentences; add link to design spec**

- [ ] **Step 4: Commit**

```bash
git add offchain/demo docs/ README.md
git commit -m "docs: credit-claim lifecycle demo and primary product alignment"
```

---

## Spec coverage checklist (self-review)

| Spec requirement | Task |
|---|---|
| CD + secured LOC core SoR | 1–2 |
| Mint CDT = full available credit | 2 (`on_chain_supply = limit` at open), 6–7 chain |
| Bearer transfer | 6 (native asset), 8 UI note |
| Cash-out draws depositor LOC | 3, 5, 8 |
| Presenter not borrower | 3 events + tests |
| Coupon stays with depositor / CD intact | 3 certificate assert |
| CIP at cash-out | 3 `cipRef` |
| Maturity waterfall B | 4 |
| Optional re-issue supply gate | 4 |
| Core wins / burn after pay | 3 order + 7 watcher |
| Invariants supply ≤ limit | 2–4 tests |
| Replace vault as primary product | 8–9 docs/UI |
| Phase 2 multi-CU network | Explicitly out of this plan |
| Securities counsel | Out of eng plan (spec §6) |

**Placeholder scan:** none intentional.  
**Type consistency:** `limitCents`, `drawnCents`, `onChainSupplyCents`, `seriesId`, presentment statuses used uniformly across tasks.

---

## Execution notes

- Always run `bank-sim` tests with Postgres up (`npm run db:up`).
- Prefer **one PR per task** or stacked commits as written.
- Do not implement multi-CU settlement network in this plan.
- Do not reintroduce holder interest vault as default open path.
