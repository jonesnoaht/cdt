/**
 * Deterministic test fixture for the webapp API tests (and `npm run smoke`).
 *
 * Seeds:
 *  - 2 CD products,
 *  - 2 members (checking + cd_funding accounts each),
 *  - Ada: one checking deposit, plus three CDs covering every status:
 *      * ACTIVE  — attested 30 days ago, matures in ~5 months (tx_hash present)
 *      * MATURED — attested 400 days ago, 6-month term (long past maturity)
 *      * PENDING — CD-funding deposit with no attestation row
 *  - Grace: no CDs (empty-state member).
 *
 * Attestation payloads mirror the oracle watcher's SignedAttestation shape:
 * { payload: { deposit_id, owner, principal(lovelace), rate_bps, start,
 *   maturity, penalty_bps }, signature, algorithm, oracle_public_key } —
 * with an optional top-level tx_hash added by the mint pipeline.
 */
import type pg from "pg";

export const DAY_MS = 86_400_000;

export interface FixtureIds {
  nowMs: number;
  products: { sixMonth: number; twelveMonth: number };
  ada: { memberId: number; checkingId: number; cdFundingId: number };
  grace: { memberId: number; checkingId: number; cdFundingId: number };
  cds: { activeTxId: number; maturedTxId: number; pendingTxId: number };
  activePayload: AttestationPayloadFixture;
  maturedPayload: AttestationPayloadFixture;
  activeTxHash: string;
}

export interface AttestationPayloadFixture {
  deposit_id: string;
  owner: string;
  principal: number; // lovelace
  rate_bps: number;
  start: number;
  maturity: number;
  penalty_bps: number;
}

const ADA_WALLET = "addr_test1qada000000000000000000000000000000000000000000000";
const ADA_DID = "did:key:zAdaFixture";
const GRACE_WALLET = "addr_test1qgrace0000000000000000000000000000000000000000000";
const GRACE_DID = "did:key:zGraceFixture";

export const ACTIVE_TX_HASH =
  "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0";

const LOVELACE_PER_CENT = 10_000;

async function createAccount(
  pool: pg.Pool,
  memberName: string,
  wallet: string,
  did: string,
  kind: "checking" | "cd_funding",
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO accounts (member_name, wallet_address, did, kind)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [memberName, wallet, did, kind],
  );
  return rows[0].id;
}

async function insertDeposit(
  pool: pg.Pool,
  accountId: number,
  amountCents: number,
  productId: number | null,
  memo: string,
  attested: boolean,
  createdAtMs: number,
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO transactions (account_id, amount_cents, kind, product_id, memo, attested, created_at)
     VALUES ($1, $2, 'deposit', $3, $4, $5, to_timestamp($6 / 1000.0))
     RETURNING id`,
    [accountId, amountCents, productId, memo, attested, createdAtMs],
  );
  return rows[0].id;
}

async function insertAttestation(
  pool: pg.Pool,
  transactionId: number,
  payload: AttestationPayloadFixture,
  txHash?: string,
): Promise<void> {
  const signed = {
    payload,
    signature: "Zml4dHVyZS1zaWduYXR1cmU=",
    algorithm: "Ed25519",
    oracle_public_key: "Zml4dHVyZS1vcmFjbGUta2V5",
    ...(txHash ? { tx_hash: txHash } : {}),
  };
  await pool.query(
    `INSERT INTO attestations (transaction_id, deposit_id, payload)
     VALUES ($1, $2, $3)`,
    [transactionId, payload.deposit_id, JSON.stringify(signed)],
  );
}

/** Truncate everything and repopulate. `nowMs` anchors all relative dates. */
export async function seedFixture(pool: pg.Pool, nowMs = Date.now()): Promise<FixtureIds> {
  await pool.query(
    "TRUNCATE attestations, transactions, accounts, cd_products RESTART IDENTITY CASCADE",
  );

  const { rows: productRows } = await pool.query(
    `INSERT INTO cd_products (name, term_months, rate_bps, penalty_bps, min_deposit_cents)
     VALUES
       ('6-Month Share Certificate', 6, 400, 1000, 50000),
       ('12-Month Share Certificate', 12, 450, 1000, 100000)
     RETURNING id`,
  );
  const sixMonth = productRows[0].id as number;
  const twelveMonth = productRows[1].id as number;

  const adaChecking = await createAccount(pool, "Ada Lovelace", ADA_WALLET, ADA_DID, "checking");
  const adaFunding = await createAccount(pool, "Ada Lovelace", ADA_WALLET, ADA_DID, "cd_funding");
  const graceChecking = await createAccount(pool, "Grace Hopper", GRACE_WALLET, GRACE_DID, "checking");
  const graceFunding = await createAccount(pool, "Grace Hopper", GRACE_WALLET, GRACE_DID, "cd_funding");

  // Everyday checking activity for balances.
  await insertDeposit(pool, adaChecking, 250_00, null, "payroll direct deposit", false, nowMs - 3 * DAY_MS);

  // ACTIVE: 12-month CD, attested 30 days ago (with a mint tx hash).
  const activeStart = nowMs - 30 * DAY_MS;
  const activeTxId = await insertDeposit(
    pool, adaFunding, 2_500_00, twelveMonth, "fund 12-month certificate", true, activeStart,
  );
  const activePayload: AttestationPayloadFixture = {
    deposit_id: String(activeTxId),
    owner: ADA_WALLET,
    principal: 2_500_00 * LOVELACE_PER_CENT,
    rate_bps: 450,
    start: activeStart,
    maturity: activeStart + 365 * DAY_MS,
    penalty_bps: 1000,
  };
  await insertAttestation(pool, activeTxId, activePayload, ACTIVE_TX_HASH);

  // MATURED: 6-month CD, attested 400 days ago (term long since ended).
  const maturedStart = nowMs - 400 * DAY_MS;
  const maturedTxId = await insertDeposit(
    pool, adaFunding, 600_00, sixMonth, "fund 6-month certificate", true, maturedStart,
  );
  const maturedPayload: AttestationPayloadFixture = {
    deposit_id: String(maturedTxId),
    owner: ADA_WALLET,
    principal: 600_00 * LOVELACE_PER_CENT,
    rate_bps: 400,
    start: maturedStart,
    maturity: maturedStart + 182 * DAY_MS,
    penalty_bps: 1000,
  };
  await insertAttestation(pool, maturedTxId, maturedPayload);

  // PENDING: unattested CD-funding deposit.
  const pendingTxId = await insertDeposit(
    pool, adaFunding, 750_00, sixMonth, "fund 6-month certificate", false, nowMs - 1 * DAY_MS,
  );

  return {
    nowMs,
    products: { sixMonth, twelveMonth },
    ada: { memberId: adaChecking, checkingId: adaChecking, cdFundingId: adaFunding },
    grace: { memberId: graceChecking, checkingId: graceChecking, cdFundingId: graceFunding },
    cds: { activeTxId, maturedTxId, pendingTxId },
    activePayload,
    maturedPayload,
    activeTxHash: ACTIVE_TX_HASH,
  };
}
