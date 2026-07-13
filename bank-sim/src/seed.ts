/**
 * Idempotent seed fixture: truncates all tables and repopulates
 *  - 3 CD products (6/12/60 months),
 *  - 3 members, each with a checking + cd_funding account,
 *  - sample deposits (checking deposits and CD-funding deposits).
 *
 * Used by `npm run seed` and by the test suite.
 */
import type pg from "pg";
import { createAccount, deposit } from "./bank.js";

export interface SeedResult {
  productIds: number[];
  checkingIds: number[];
  cdFundingIds: number[];
  /** Transaction ids of the CD-funding deposits, in insertion order. */
  cdDepositTxIds: number[];
}

export const SEED_MEMBERS = [
  {
    name: "Ada Lovelace",
    wallet:
      "addr1qxck8vsqmts6y7x83f2m3z0lqu4rvyq3n5cakxz7s6h9dqf4l2m8vwypj0y6l5u3nqk7rd9jq6wz0t8g4a3xm5s2k9hqs3v7e4u",
    did: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
  },
  {
    name: "Grace Hopper",
    wallet:
      "addr1q9jw8fkr0e5u2n7h3v6y4t8s0dq2xm5cp7l9b4a6z3g8kqe2n5v7y0j4u8h6t3s9d1f5m2x7c4b0a8z6l3w9r5p1qsk2m4v8",
    did: "did:key:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG",
  },
  {
    name: "Satoshi Tanaka",
    wallet:
      "addr1qy7r3m9x5c2v8b4n0a6z1l7w3j9u5h8t4s2d6f0g5k1p9e3n7v2y6j0u4h8t5s1d9f3m7x2c6b8a0z4l6w2r8p0qs5k7m1v3",
    did: "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH",
  },
] as const;

export async function seed(pool: pg.Pool): Promise<SeedResult> {
  await pool.query(
    "TRUNCATE attestations, transactions, accounts, cd_products RESTART IDENTITY CASCADE",
  );

  // --- CD products --------------------------------------------------------
  const { rows: products } = await pool.query(
    `INSERT INTO cd_products (name, term_months, rate_bps, penalty_bps, min_deposit_cents)
     VALUES
       ('6-Month Share Certificate',  6,  400, 1000,   50000),
       ('12-Month Share Certificate', 12, 450, 1000,  100000),
       ('60-Month Share Certificate', 60, 500, 1000,  500000)
     RETURNING id`,
  );
  const productIds = products.map((r: { id: number }) => r.id);

  // --- Members: one checking + one cd_funding account each ----------------
  const checkingIds: number[] = [];
  const cdFundingIds: number[] = [];
  for (const m of SEED_MEMBERS) {
    const checking = await createAccount(pool, {
      memberName: m.name,
      walletAddress: m.wallet,
      did: m.did,
      kind: "checking",
    });
    const cdFunding = await createAccount(pool, {
      memberName: m.name,
      walletAddress: m.wallet,
      did: m.did,
      kind: "cd_funding",
    });
    checkingIds.push(checking.id);
    cdFundingIds.push(cdFunding.id);
  }

  // --- Sample deposits -----------------------------------------------------
  // Everyday checking deposits.
  const checkingDeposits = [
    { i: 0, amountCents: 250_00, memo: "payroll direct deposit" },
    { i: 1, amountCents: 1_200_00, memo: "payroll direct deposit" },
    { i: 2, amountCents: 75_50, memo: "mobile check deposit" },
  ];
  for (const d of checkingDeposits) {
    await deposit(pool, {
      accountId: checkingIds[d.i]!,
      amountCents: d.amountCents,
      memo: d.memo,
    });
  }

  // CD-funding deposits — these are what the oracle watcher attests.
  const cdDepositTxIds: number[] = [];
  const cdDeposits = [
    { i: 0, amountCents: 500_00, memo: "fund 6-month certificate" },
    { i: 1, amountCents: 2_500_00, memo: "fund 12-month certificate" },
    { i: 2, amountCents: 10_000_00, memo: "fund 60-month certificate" },
  ];
  for (const d of cdDeposits) {
    const tx = await deposit(pool, {
      accountId: cdFundingIds[d.i]!,
      amountCents: d.amountCents,
      productId: productIds[d.i]!,
      memo: d.memo,
    });
    cdDepositTxIds.push(tx.id);
  }

  return { productIds, checkingIds, cdFundingIds, cdDepositTxIds };
}
