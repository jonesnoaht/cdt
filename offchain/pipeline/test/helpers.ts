/**
 * Test helpers: dockerized bank Postgres (test/docker-compose.yml, host
 * port 55434 unless PGPORT overrides it) + seeding utilities.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { createPool } from "../../../bank-sim/src/index.ts";
import type { WatcherLogger } from "../../oracle-watcher/src/index.ts";

// Defaults match test/docker-compose.yml; PGPORT set by the caller wins.
process.env.PGPORT ??= "55434";

const here = dirname(fileURLToPath(import.meta.url));

export function testPool(): pg.Pool {
  return createPool();
}

/** Drop and re-apply the vendored bank schema (test/fixtures/schema.sql). */
export async function resetSchema(pool: pg.Pool): Promise<void> {
  const schema = readFileSync(join(here, "fixtures", "schema.sql"), "utf8");
  await pool.query(
    "DROP TABLE IF EXISTS attestations, transactions, accounts, cd_products CASCADE",
  );
  await pool.query(schema);
}

export async function seedProduct(
  pool: pg.Pool,
  opts: {
    name?: string;
    termMonths?: number;
    rateBps?: number;
    penaltyBps?: number;
    minDepositCents?: bigint;
  } = {},
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO cd_products (name, term_months, rate_bps, penalty_bps, min_deposit_cents)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      opts.name ?? "6-Month Share Certificate",
      opts.termMonths ?? 6,
      opts.rateBps ?? 400,
      opts.penaltyBps ?? 1000,
      (opts.minDepositCents ?? 50_000n).toString(),
    ],
  );
  return rows[0].id as number;
}

export async function seedAccount(
  pool: pg.Pool,
  opts: {
    memberName?: string;
    walletAddress?: string;
    did: string;
    kind?: "checking" | "cd_funding";
  },
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO accounts (member_name, wallet_address, did, kind)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      opts.memberName ?? "Ada Lovelace",
      opts.walletAddress ?? "addr_test1_placeholder",
      opts.did,
      opts.kind ?? "cd_funding",
    ],
  );
  return rows[0].id as number;
}

export async function seedDeposit(
  pool: pg.Pool,
  opts: { accountId: number; amountCents: bigint; productId: number },
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO transactions (account_id, amount_cents, kind, product_id, memo)
     VALUES ($1, $2, 'deposit', $3, 'test CD deposit') RETURNING id`,
    [opts.accountId, opts.amountCents.toString(), opts.productId],
  );
  return rows[0].id as number;
}

export const quietLog: WatcherLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
