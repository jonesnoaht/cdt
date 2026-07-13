/**
 * Integration tests against the real dockerized Postgres.
 * Prereq: `docker compose up -d --wait` (schema auto-applied on first boot).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  createAccount,
  createPool,
  deposit,
  getBalances,
  listUnattestedCdDeposits,
  recordAttestation,
} from "../src/index.js";
import { seed, SEED_MEMBERS, type SeedResult } from "../src/seed.js";

let pool: pg.Pool;
let seeded: SeedResult;

beforeAll(async () => {
  pool = createPool();
  seeded = await seed(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("seed", () => {
  it("is idempotent (re-running yields the same shape)", async () => {
    const again = await seed(pool);
    expect(again.productIds).toHaveLength(3);
    expect(again.checkingIds).toHaveLength(3);
    expect(again.cdFundingIds).toHaveLength(3);
    expect(again.cdDepositTxIds).toHaveLength(3);
    seeded = again;
  });
});

describe("listUnattestedCdDeposits", () => {
  it("returns exactly the seeded cd_funding deposits with account + product joined", async () => {
    const rows = await listUnattestedCdDeposits(pool);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.transactionId)).toEqual(seeded.cdDepositTxIds);

    const first = rows[0]!;
    expect(first.amountCents).toBe(500_00);
    expect(first.account.memberName).toBe(SEED_MEMBERS[0].name);
    expect(first.account.walletAddress).toBe(SEED_MEMBERS[0].wallet);
    expect(first.account.did).toMatch(/^did:key:z/);
    expect(first.product.termMonths).toBe(6);
    expect(first.product.rateBps).toBe(400);
    expect(first.product.penaltyBps).toBe(1000);
    expect(first.product.minDepositCents).toBe(500_00);
  });

  it("excludes checking deposits and deposits without a product", async () => {
    // A plain deposit into a cd_funding account with no product_id must not appear.
    const tx = await deposit(pool, {
      accountId: seeded.cdFundingIds[0]!,
      amountCents: 10_00,
      memo: "top-up without product",
    });
    const rows = await listUnattestedCdDeposits(pool);
    expect(rows.map((r) => r.transactionId)).not.toContain(tx.id);
    expect(rows).toHaveLength(3);
  });
});

describe("recordAttestation", () => {
  it("flips attested=true and removes the row from the unattested list", async () => {
    const txId = seeded.cdDepositTxIds[0]!;
    const attestation = await recordAttestation(pool, txId, "dep-0001", {
      schema: "cdt/attestation/v1",
      amountCents: 500_00,
    });
    expect(attestation.transactionId).toBe(txId);
    expect(attestation.depositId).toBe("dep-0001");
    expect(attestation.signedAt).toBeInstanceOf(Date);

    const { rows } = await pool.query(
      "SELECT attested FROM transactions WHERE id = $1",
      [txId],
    );
    expect(rows[0].attested).toBe(true);

    const unattested = await listUnattestedCdDeposits(pool);
    expect(unattested.map((r) => r.transactionId)).not.toContain(txId);
  });

  it("rejects a second attestation for the same transaction (UNIQUE)", async () => {
    const txId = seeded.cdDepositTxIds[0]!;
    await expect(
      recordAttestation(pool, txId, "dep-0001-dupe", { dupe: true }),
    ).rejects.toThrow(/unique|duplicate key/i);

    // Original attestation must be untouched.
    const { rows } = await pool.query(
      "SELECT deposit_id FROM attestations WHERE transaction_id = $1",
      [txId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].deposit_id).toBe("dep-0001");
  });

  it("rolls back cleanly when the transaction does not exist", async () => {
    await expect(
      recordAttestation(pool, 999_999, "dep-missing", {}),
    ).rejects.toThrow(/does not exist|foreign key/i);
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM attestations WHERE deposit_id = 'dep-missing'",
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("constraints and validation", () => {
  it("rejects an account with an invalid kind (CHECK constraint)", async () => {
    await expect(
      createAccount(pool, {
        memberName: "Eve Mallory",
        walletAddress: "addr1qbadbadbadbadbadbadbadbadbadbadbad",
        did: "did:key:z6MkBadBadBadBadBadBadBadBadBadBadBadBadBadBad",
        // Force an invalid kind through the type system to hit the DB CHECK.
        kind: "savings" as never,
      }),
    ).rejects.toThrow(/check constraint/i);
  });

  it("rejects a CD-funding deposit into a checking account", async () => {
    await expect(
      deposit(pool, {
        accountId: seeded.checkingIds[0]!,
        amountCents: 500_00,
        productId: seeded.productIds[0]!,
        memo: "wrong account kind",
      }),
    ).rejects.toThrow(/cd_funding/);
  });

  it("rejects non-positive and non-integer deposit amounts", async () => {
    await expect(
      deposit(pool, { accountId: seeded.checkingIds[0]!, amountCents: -100 }),
    ).rejects.toThrow(/positive/);
    await expect(
      deposit(pool, { accountId: seeded.checkingIds[0]!, amountCents: 0 }),
    ).rejects.toThrow(/positive/);
    await expect(
      deposit(pool, { accountId: seeded.checkingIds[0]!, amountCents: 10.5 }),
    ).rejects.toThrow(/integer/);
  });

  it("rejects a CD deposit below the product minimum", async () => {
    await expect(
      deposit(pool, {
        accountId: seeded.cdFundingIds[0]!,
        amountCents: 1_00,
        productId: seeded.productIds[2]!, // 60-month, $5,000 minimum
      }),
    ).rejects.toThrow(/minimum/);
  });

  it("rejects a non-positive amount at the DB level (CHECK), bypassing the access layer", async () => {
    await expect(
      pool.query(
        `INSERT INTO transactions (account_id, amount_cents, kind)
         VALUES ($1, -500, 'deposit')`,
        [seeded.checkingIds[0]!],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it("rejects a transaction referencing a missing account (FK)", async () => {
    await expect(
      pool.query(
        `INSERT INTO transactions (account_id, amount_cents, kind)
         VALUES (999999, 100, 'deposit')`,
      ),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe("getBalances", () => {
  it("sums deposits and withdrawals", async () => {
    const account = await createAccount(pool, {
      memberName: "Balance Tester",
      walletAddress:
        "addr1q8balance0tester0000000000000000000000000000000000000000",
      did: "did:key:z6MkBalanceTester11111111111111111111111111111",
      kind: "checking",
    });
    await deposit(pool, { accountId: account.id, amountCents: 10_000 });
    await deposit(pool, { accountId: account.id, amountCents: 2_500 });
    await pool.query(
      `INSERT INTO transactions (account_id, amount_cents, kind, memo)
       VALUES ($1, 4000, 'withdrawal', 'ATM')`,
      [account.id],
    );

    const balances = await getBalances(pool, account.id);
    expect(balances).toEqual({
      accountId: account.id,
      depositsCents: 12_500,
      withdrawalsCents: 4_000,
      balanceCents: 8_500,
    });
  });

  it("returns zeros for an account with no transactions", async () => {
    const account = await createAccount(pool, {
      memberName: "Empty Account",
      walletAddress:
        "addr1q8empty0account000000000000000000000000000000000000000000",
      did: "did:key:z6MkEmptyAccount1111111111111111111111111111111",
      kind: "cd_funding",
    });
    const balances = await getBalances(pool, account.id);
    expect(balances.balanceCents).toBe(0);
    expect(balances.depositsCents).toBe(0);
    expect(balances.withdrawalsCents).toBe(0);
  });

  it("throws for a missing account", async () => {
    await expect(getBalances(pool, 999_999)).rejects.toThrow(/does not exist/);
  });
});
