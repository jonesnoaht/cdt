import type pg from "pg";
import type { Queryable } from "./db.js";
import type {
  Account,
  Attestation,
  Balances,
  BankTransaction,
  DepositInput,
  NewAccount,
  UnattestedCdDeposit,
} from "./types.js";

function rowToAccount(row: Record<string, unknown>): Account {
  return {
    id: row.id as number,
    memberName: row.member_name as string,
    walletAddress: row.wallet_address as string,
    did: row.did as string,
    kind: row.kind as Account["kind"],
    createdAt: row.created_at as Date,
  };
}

function rowToTransaction(row: Record<string, unknown>): BankTransaction {
  return {
    id: row.id as number,
    accountId: row.account_id as number,
    amountCents: Number(row.amount_cents),
    kind: row.kind as BankTransaction["kind"],
    productId: row.product_id as number | null,
    memo: row.memo as string | null,
    attested: row.attested as boolean,
    createdAt: row.created_at as Date,
  };
}

/** Open a new member account (checking or cd_funding). */
export async function createAccount(
  db: Queryable,
  input: NewAccount,
): Promise<Account> {
  const { rows } = await db.query(
    `INSERT INTO accounts (member_name, wallet_address, did, kind)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.memberName, input.walletAddress, input.did, input.kind],
  );
  return rowToAccount(rows[0]);
}

/**
 * Record a deposit.
 *
 * - amountCents must be a positive integer.
 * - If productId is given (a CD-funding deposit), the target account must be
 *   a cd_funding account and the amount must meet the product's minimum.
 */
export async function deposit(
  db: Queryable,
  input: DepositInput,
): Promise<BankTransaction> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error(
      `deposit amount must be a positive integer number of cents, got ${input.amountCents}`,
    );
  }

  if (input.productId != null) {
    // One round-trip for both validation facts (account kind, product minimum).
    const { rows } = await db.query(
      `SELECT a.kind, p.min_deposit_cents
       FROM accounts a
       LEFT JOIN cd_products p ON p.id = $2
       WHERE a.id = $1`,
      [input.accountId, input.productId],
    );
    if (rows.length === 0) {
      throw new Error(`account ${input.accountId} does not exist`);
    }
    if (rows[0].kind !== "cd_funding") {
      throw new Error(
        `CD-funding deposits (product_id set) require a cd_funding account; account ${input.accountId} is '${rows[0].kind}'`,
      );
    }
    if (rows[0].min_deposit_cents == null) {
      throw new Error(`cd_product ${input.productId} does not exist`);
    }
    const minDeposit = Number(rows[0].min_deposit_cents);
    if (input.amountCents < minDeposit) {
      throw new Error(
        `deposit of ${input.amountCents} cents is below product minimum of ${minDeposit} cents`,
      );
    }
  }

  const { rows } = await db.query(
    `INSERT INTO transactions (account_id, amount_cents, kind, product_id, memo)
     VALUES ($1, $2, 'deposit', $3, $4)
     RETURNING *`,
    [input.accountId, input.amountCents, input.productId ?? null, input.memo ?? null],
  );
  return rowToTransaction(rows[0]);
}

/**
 * List CD-funding deposits the oracle has not yet attested:
 * kind='deposit' on a cd_funding account, with a product, attested=false.
 */
export async function listUnattestedCdDeposits(
  db: Queryable,
): Promise<UnattestedCdDeposit[]> {
  const { rows } = await db.query(
    `SELECT
       t.id             AS transaction_id,
       t.amount_cents,
       t.memo,
       t.created_at,
       a.id             AS account_id,
       a.member_name,
       a.wallet_address,
       a.did,
       p.id             AS product_id,
       p.name           AS product_name,
       p.term_months,
       p.rate_bps,
       p.penalty_bps,
       p.min_deposit_cents
     FROM transactions t
     JOIN accounts    a ON a.id = t.account_id
     JOIN cd_products p ON p.id = t.product_id
     WHERE t.kind = 'deposit'
       AND a.kind = 'cd_funding'
       AND t.product_id IS NOT NULL
       AND t.attested = false
     ORDER BY t.id`,
  );
  return rows.map((row: Record<string, unknown>) => ({
    transactionId: row.transaction_id as number,
    amountCents: Number(row.amount_cents),
    memo: row.memo as string | null,
    createdAt: row.created_at as Date,
    account: {
      id: row.account_id as number,
      memberName: row.member_name as string,
      walletAddress: row.wallet_address as string,
      did: row.did as string,
    },
    product: {
      id: row.product_id as number,
      name: row.product_name as string,
      termMonths: row.term_months as number,
      rateBps: row.rate_bps as number,
      penaltyBps: row.penalty_bps as number,
      minDepositCents: Number(row.min_deposit_cents),
    },
  }));
}

/**
 * Record the oracle's attestation for a deposit and mark the transaction
 * attested — both in a single database transaction. A second attestation for
 * the same transaction fails on the UNIQUE(transaction_id) constraint and
 * leaves the row untouched.
 */
export async function recordAttestation(
  pool: pg.Pool,
  transactionId: number,
  depositId: string,
  payload: unknown,
): Promise<Attestation> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // JSON.stringify so any payload shape (including strings) lands as valid
    // JSONB; undefined would stringify to undefined and bind as SQL NULL,
    // violating NOT NULL, so normalize it to JSON null.
    const { rows } = await client.query(
      `INSERT INTO attestations (transaction_id, deposit_id, account_id, attestation_hash, payload)
       SELECT $1, $2, t.account_id::text, COALESCE($4, ''), $3
         FROM transactions t
        WHERE t.id = $1
       RETURNING *`,
      [
        transactionId,
        depositId,
        JSON.stringify(payload ?? null),
        typeof payload === "object" && payload && "attestation_hash_hex" in (payload as object)
          ? String((payload as { attestation_hash_hex?: string }).attestation_hash_hex ?? "")
          : "",
      ],
    );
    if (rows.length !== 1) {
      throw new Error(`transaction ${transactionId} does not exist`);
    }
    // A nonexistent transactionId is rejected by the FK on the INSERT above,
    // so the UPDATE is guaranteed to match exactly one row.
    await client.query(
      `UPDATE transactions SET attested = true WHERE id = $1`,
      [transactionId],
    );
    await client.query("COMMIT");
    const row = rows[0];
    return {
      id: row.id as number,
      transactionId: row.transaction_id as number,
      depositId: row.deposit_id as string,
      payload: row.payload,
      signedAt: row.signed_at as Date,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Sum deposits and withdrawals for an account. Throws if the account does not exist. */
export async function getBalances(
  db: Queryable,
  accountId: number,
): Promise<Balances> {
  const { rows } = await db.query(
    `SELECT
       a.id AS account_id,
       COALESCE(SUM(t.amount_cents) FILTER (WHERE t.kind = 'deposit'), 0)    AS deposits_cents,
       COALESCE(SUM(t.amount_cents) FILTER (WHERE t.kind = 'withdrawal'), 0) AS withdrawals_cents
     FROM accounts a
     LEFT JOIN transactions t ON t.account_id = a.id
     WHERE a.id = $1
     GROUP BY a.id`,
    [accountId],
  );
  if (rows.length === 0) {
    throw new Error(`account ${accountId} does not exist`);
  }
  const depositsCents = Number(rows[0].deposits_cents);
  const withdrawalsCents = Number(rows[0].withdrawals_cents);
  return {
    accountId,
    depositsCents,
    withdrawalsCents,
    balanceCents: depositsCents - withdrawalsCents,
  };
}
