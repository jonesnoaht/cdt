import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { createPool, loadConfig } from '../src/config.js';
import {
  createIdentity,
  createPresentation,
  issueCredential,
  verifyPresentation,
  type MockIdentity,
  type MockPresentation,
} from '../src/vc-mock.js';
import type { VerifyPresentationHook } from '../src/watcher.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Connect exactly the way the shipped config path does (env-driven, port 55433 default). */
export function testPool(): pg.Pool {
  return createPool(loadConfig().pg);
}

/** Drop and re-create the vendored bank schema (test/fixtures/schema.sql). */
export async function resetSchema(pool: pg.Pool): Promise<void> {
  const schema = readFileSync(join(here, 'fixtures', 'schema.sql'), 'utf8');
  await pool.query('DROP TABLE IF EXISTS attestations, transactions, accounts, cd_products CASCADE');
  await pool.query(schema);
}

export interface SeededDeposit {
  productId: number;
  accountId: number;
  transactionId: number;
}

export async function seedProduct(
  pool: pg.Pool,
  opts: { name?: string; termMonths?: number; rateBps?: number; penaltyBps?: number; minDepositCents?: bigint } = {},
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO cd_products (name, term_months, rate_bps, penalty_bps, min_deposit_cents)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [opts.name ?? '12-month CD', opts.termMonths ?? 12, opts.rateBps ?? 450, opts.penaltyBps ?? 200, (opts.minDepositCents ?? 50_000n).toString()],
  );
  return rows[0].id as number;
}

export async function seedAccount(
  pool: pg.Pool,
  opts: { memberName?: string; walletAddress?: string; did: string; kind?: 'checking' | 'cd_funding' },
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO accounts (member_name, wallet_address, did, kind)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [opts.memberName ?? 'Alice Member', opts.walletAddress ?? 'addr_test1qalice', opts.did, opts.kind ?? 'cd_funding'],
  );
  return rows[0].id as number;
}

export async function seedDeposit(
  pool: pg.Pool,
  opts: { accountId: number; amountCents: bigint; productId: number | null; kind?: 'deposit' | 'withdrawal' },
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO transactions (account_id, amount_cents, kind, product_id, memo)
     VALUES ($1, $2, $3, $4, 'test deposit') RETURNING id`,
    [opts.accountId, opts.amountCents.toString(), opts.kind ?? 'deposit', opts.productId],
  );
  return rows[0].id as number;
}

/** A full mock trust chain: NCUA root -> credit union -> member. */
export interface MockTrustChain {
  ncua: MockIdentity;
  creditUnion: MockIdentity;
  member: MockIdentity;
  presentation: MockPresentation;
}

export function buildTrustChain(memberDid: string, opts: { memberCredExpiresInMs?: number } = {}): MockTrustChain {
  const ncua = createIdentity('did:cdt:ncua');
  const creditUnion = createIdentity('did:cdt:credit-union:demo-fcu');
  const member = createIdentity(memberDid);
  const cuCred = issueCredential(ncua, {
    did: creditUnion.did,
    role: 'credit-union',
    publicKeyBase64: creditUnion.publicKeyBase64,
  });
  const memberCred = issueCredential(
    creditUnion,
    { did: member.did, role: 'member', publicKeyBase64: member.publicKeyBase64 },
    opts.memberCredExpiresInMs !== undefined ? { expiresInMs: opts.memberCredExpiresInMs } : {},
  );
  const presentation = createPresentation(member, [cuCred, memberCred]);
  return { ncua, creditUnion, member, presentation };
}

/**
 * A verifyPresentation hook backed by the vendored mock verifier: looks up
 * the presentation registered for the member DID and verifies it against the
 * trusted NCUA root.
 */
export function mockVerifierHook(
  trustedRoot: MockIdentity,
  presentations: Map<string, MockPresentation>,
): VerifyPresentationHook {
  return (memberDid) => {
    const presentation = presentations.get(memberDid);
    if (!presentation) return { verified: false, error: `no presentation on file for ${memberDid}` };
    return verifyPresentation(presentation, {
      trustedRootDid: trustedRoot.did,
      trustedRootPublicKeyBase64: trustedRoot.publicKeyBase64,
      expectedHolderDid: memberDid,
    });
  };
}

export const quietLog = { info: () => {}, warn: () => {}, error: () => {} };
