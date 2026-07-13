import { createPublicKey } from 'node:crypto';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MS_PER_MONTH, verifyAttestation, type SignedAttestation } from '../src/attestation.js';
import { canonicalize } from '../src/canonicalize.js';
import { loadConfig } from '../src/config.js';
import { generateEd25519KeyPair, publicKeyToBase64, signUtf8 } from '../src/keys.js';
import { createPresentation, issueCredential, verifyPresentation } from '../src/vc-mock.js';
import { OracleWatcher } from '../src/watcher.js';
import {
  buildTrustChain,
  mockVerifierHook,
  quietLog,
  resetSchema,
  seedAccount,
  seedDeposit,
  seedProduct,
  testPool,
} from './helpers.js';

const MEMBER_DID = 'did:cdt:member:alice';

let pool: pg.Pool;

beforeAll(async () => {
  pool = testPool();
  // fail fast with a clear message if the docker compose DB is not up
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    throw new Error(
      `Cannot reach test Postgres on port ${process.env.PGPORT ?? 55433}. ` +
        `Start it with: docker compose -f test/docker-compose.yml up -d --wait (${String(err)})`,
    );
  }
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetSchema(pool);
});

function makeWatcher(opts: {
  onAttested?: (a: SignedAttestation) => void;
  pollIntervalMs?: number;
  chainOverrides?: { memberCredExpiresInMs?: number };
  did?: string;
}) {
  const did = opts.did ?? MEMBER_DID;
  const chain = buildTrustChain(did, opts.chainOverrides ?? {});
  const oracleKeys = generateEd25519KeyPair();
  const watcher = new OracleWatcher({
    pool,
    oraclePrivateKey: oracleKeys.privateKey,
    verifyPresentation: mockVerifierHook(chain.ncua, new Map([[did, chain.presentation]])),
    ...(opts.onAttested ? { onAttested: opts.onAttested } : {}),
    ...(opts.pollIntervalMs !== undefined ? { pollIntervalMs: opts.pollIntervalMs } : {}),
    log: quietLog,
  });
  return { watcher, chain, oracleKeys };
}

describe('mock VC verifier', () => {
  it('accepts a valid NCUA -> credit union -> member chain', () => {
    const chain = buildTrustChain(MEMBER_DID);
    const result = verifyPresentation(chain.presentation, {
      trustedRootDid: chain.ncua.did,
      trustedRootPublicKeyBase64: chain.ncua.publicKeyBase64,
      expectedHolderDid: MEMBER_DID,
    });
    expect(result).toEqual({ verified: true });
  });

  it('rejects a chain not rooted at the trusted NCUA key', () => {
    const chain = buildTrustChain(MEMBER_DID);
    const imposterRoot = buildTrustChain(MEMBER_DID).ncua; // same DID, different key
    const result = verifyPresentation(chain.presentation, {
      trustedRootDid: imposterRoot.did,
      trustedRootPublicKeyBase64: imposterRoot.publicKeyBase64,
      expectedHolderDid: MEMBER_DID,
    });
    expect(result.verified).toBe(false);
  });

  it('rejects an expired member credential', () => {
    const chain = buildTrustChain(MEMBER_DID, { memberCredExpiresInMs: -1000 });
    const result = verifyPresentation(chain.presentation, {
      trustedRootDid: chain.ncua.did,
      trustedRootPublicKeyBase64: chain.ncua.publicKeyBase64,
      expectedHolderDid: MEMBER_DID,
    });
    expect(result).toMatchObject({ verified: false, error: expect.stringContaining('expired') });
  });

  it('fails closed on a missing or malformed expirationDate (never accepts NaN as unexpired)', () => {
    const chain = buildTrustChain(MEMBER_DID);
    // Re-issue the member credential with a garbage expirationDate, properly
    // signed by the credit union so only the date check can reject it.
    const memberCred = chain.presentation.verifiableCredential.find((c) => c.credentialSubject.role === 'member')!;
    const tampered = { ...memberCred, expirationDate: 'not-a-date' };
    delete (tampered as { proof?: unknown }).proof;
    tampered.proof = {
      type: 'Ed25519Signature2020',
      created: new Date().toISOString(),
      verificationMethod: chain.creditUnion.did,
      proofValue: signUtf8(canonicalize({ ...tampered, proof: undefined }), chain.creditUnion.privateKey),
    };
    const cuCred = chain.presentation.verifiableCredential.find((c) => c.credentialSubject.role === 'credit-union')!;
    const presentation = createPresentation(chain.member, [cuCred, tampered]);
    const result = verifyPresentation(presentation, {
      trustedRootDid: chain.ncua.did,
      trustedRootPublicKeyBase64: chain.ncua.publicKeyBase64,
      expectedHolderDid: MEMBER_DID,
    });
    expect(result).toMatchObject({ verified: false, error: expect.stringContaining('malformed expirationDate') });
  });

  it('rejects a not-yet-valid (future issuanceDate) member credential', () => {
    const chain = buildTrustChain(MEMBER_DID);
    const cuCred = chain.presentation.verifiableCredential.find((c) => c.credentialSubject.role === 'credit-union')!;
    const futureCred = issueCredential(
      chain.creditUnion,
      { did: chain.member.did, role: 'member', publicKeyBase64: chain.member.publicKeyBase64 },
      { issuedAt: Date.now() + 24 * 3600 * 1000 },
    );
    const presentation = createPresentation(chain.member, [cuCred, futureCred]);
    const result = verifyPresentation(presentation, {
      trustedRootDid: chain.ncua.did,
      trustedRootPublicKeyBase64: chain.ncua.publicKeyBase64,
      expectedHolderDid: MEMBER_DID,
    });
    expect(result).toMatchObject({ verified: false, error: expect.stringContaining('not yet valid') });
  });

  it('rejects ambiguous presentations carrying duplicate credentials for a role', () => {
    const chain = buildTrustChain(MEMBER_DID);
    const [cuCred, memberCred] = chain.presentation.verifiableCredential;
    const presentation = createPresentation(chain.member, [cuCred!, memberCred!, memberCred!]);
    const result = verifyPresentation(presentation, {
      trustedRootDid: chain.ncua.did,
      trustedRootPublicKeyBase64: chain.ncua.publicKeyBase64,
      expectedHolderDid: MEMBER_DID,
    });
    expect(result).toMatchObject({ verified: false, error: expect.stringContaining('exactly one member credential') });
  });

  it('rejects a presentation signed by someone other than the credentialed member', () => {
    const chain = buildTrustChain(MEMBER_DID);
    const mallory = buildTrustChain('did:cdt:member:mallory').member;
    const stolen = createPresentation(
      { ...mallory, did: MEMBER_DID }, // mallory signs, claiming alice's DID
      chain.presentation.verifiableCredential,
    );
    const result = verifyPresentation(stolen, {
      trustedRootDid: chain.ncua.did,
      trustedRootPublicKeyBase64: chain.ncua.publicKeyBase64,
      expectedHolderDid: MEMBER_DID,
    });
    expect(result).toMatchObject({ verified: false, error: expect.stringContaining('presentation proof') });
  });
});

describe('OracleWatcher end-to-end (real Postgres)', () => {
  it('polls, verifies, signs, records the attestation, and invokes onAttested', async () => {
    const productId = await seedProduct(pool, { termMonths: 12, rateBps: 450, penaltyBps: 200, minDepositCents: 50_000n });
    const accountId = await seedAccount(pool, { did: MEMBER_DID, walletAddress: 'addr_test1qalice' });
    const txId = await seedDeposit(pool, { accountId, amountCents: 100_000n, productId });

    const onAttested = vi.fn();
    const { watcher, oracleKeys } = makeWatcher({ onAttested });

    const before = Date.now();
    const recorded = await watcher.pollOnce();
    const after = Date.now();

    expect(recorded).toHaveLength(1);
    expect(onAttested).toHaveBeenCalledTimes(1);
    const attestation: SignedAttestation = onAttested.mock.calls[0]![0];

    // payload shape and values
    expect(attestation.payload.deposit_id).toBe(String(txId));
    expect(attestation.payload.owner).toBe('addr_test1qalice');
    expect(attestation.payload.principal).toBe(100_000 * 10_000); // 1 cent = 10,000 lovelace (demo peg)
    expect(attestation.payload.rate_bps).toBe(450);
    expect(attestation.payload.penalty_bps).toBe(200);
    expect(attestation.payload.start).toBeGreaterThanOrEqual(before);
    expect(attestation.payload.start).toBeLessThanOrEqual(after);
    expect(attestation.payload.maturity).toBe(attestation.payload.start + 12 * MS_PER_MONTH);

    // signature verifies with the oracle public key (both KeyObject and the embedded base64 key)
    expect(verifyAttestation(attestation, oracleKeys.publicKey)).toBe(true);
    expect(publicKeyToBase64(createPublicKey(oracleKeys.privateKey))).toBe(attestation.oracle_public_key);
    expect(verifyAttestation(attestation, attestation.oracle_public_key)).toBe(true);
    // tampering breaks the signature
    expect(verifyAttestation({ ...attestation, payload: { ...attestation.payload, principal: 1 } }, oracleKeys.publicKey)).toBe(false);

    // DB state: attestation row recorded, transaction flagged
    const att = await pool.query('SELECT transaction_id, deposit_id, payload FROM attestations');
    expect(att.rowCount).toBe(1);
    expect(att.rows[0].transaction_id).toBe(txId);
    expect(att.rows[0].deposit_id).toBe(String(txId));
    expect(att.rows[0].payload).toEqual(JSON.parse(JSON.stringify(attestation)));
    const tx = await pool.query('SELECT attested FROM transactions WHERE id = $1', [txId]);
    expect(tx.rows[0].attested).toBe(true);
  });

  it('skips deposits below the product minimum without attesting', async () => {
    const productId = await seedProduct(pool, { minDepositCents: 50_000n });
    const accountId = await seedAccount(pool, { did: MEMBER_DID });
    const txId = await seedDeposit(pool, { accountId, amountCents: 49_999n, productId });

    const onAttested = vi.fn();
    const { watcher } = makeWatcher({ onAttested });
    const recorded = await watcher.pollOnce();

    expect(recorded).toHaveLength(0);
    expect(onAttested).not.toHaveBeenCalled();
    expect((await pool.query('SELECT * FROM attestations')).rowCount).toBe(0);
    const tx = await pool.query('SELECT attested FROM transactions WHERE id = $1', [txId]);
    expect(tx.rows[0].attested).toBe(false);
  });

  it('skips deposits whose VC presentation fails verification', async () => {
    const productId = await seedProduct(pool);
    const accountId = await seedAccount(pool, { did: MEMBER_DID });
    await seedDeposit(pool, { accountId, amountCents: 100_000n, productId });

    const onAttested = vi.fn();
    // expired member credential -> verification must fail
    const { watcher } = makeWatcher({ onAttested, chainOverrides: { memberCredExpiresInMs: -1000 } });
    const recorded = await watcher.pollOnce();

    expect(recorded).toHaveLength(0);
    expect(onAttested).not.toHaveBeenCalled();
    expect((await pool.query('SELECT * FROM attestations')).rowCount).toBe(0);
    expect((await pool.query(`SELECT * FROM transactions WHERE attested = true`)).rowCount).toBe(0);
  });

  it('ignores deposits on non-cd_funding accounts and deposits without a product', async () => {
    const productId = await seedProduct(pool);
    const checkingId = await seedAccount(pool, { did: MEMBER_DID, kind: 'checking' });
    const cdId = await seedAccount(pool, { did: MEMBER_DID, kind: 'cd_funding' });
    await seedDeposit(pool, { accountId: checkingId, amountCents: 100_000n, productId });
    await seedDeposit(pool, { accountId: cdId, amountCents: 100_000n, productId: null });

    const onAttested = vi.fn();
    const { watcher } = makeWatcher({ onAttested });
    expect(await watcher.pollOnce()).toHaveLength(0);
    expect(onAttested).not.toHaveBeenCalled();
    expect((await pool.query('SELECT * FROM attestations')).rowCount).toBe(0);
  });

  it('is idempotent across poll cycles and respects the UNIQUE constraint', async () => {
    const productId = await seedProduct(pool);
    const accountId = await seedAccount(pool, { did: MEMBER_DID });
    const txId = await seedDeposit(pool, { accountId, amountCents: 100_000n, productId });

    const onAttested = vi.fn();
    const { watcher } = makeWatcher({ onAttested });

    expect(await watcher.pollOnce()).toHaveLength(1);
    expect(await watcher.pollOnce()).toHaveLength(0); // second cycle: nothing to do
    expect(onAttested).toHaveBeenCalledTimes(1);
    expect((await pool.query('SELECT * FROM attestations')).rowCount).toBe(1);

    // Simulated race: an attestation row exists but attested was left false.
    await pool.query('UPDATE transactions SET attested = false WHERE id = $1', [txId]);
    expect(await watcher.pollOnce()).toHaveLength(0); // ON CONFLICT DO NOTHING -> no double attestation
    expect(onAttested).toHaveBeenCalledTimes(1);
    expect((await pool.query('SELECT * FROM attestations')).rowCount).toBe(1);
    // ...and the state converges: the flag is reconciled so the deposit is not reprocessed forever
    const reconciled = await pool.query('SELECT attested FROM transactions WHERE id = $1', [txId]);
    expect(reconciled.rows[0].attested).toBe(true);
    expect(await watcher.pollOnce()).toHaveLength(0);
  });

  it('retries onAttested delivery on the next poll cycle when the hook fails', async () => {
    const productId = await seedProduct(pool);
    const accountId = await seedAccount(pool, { did: MEMBER_DID });
    const txId = await seedDeposit(pool, { accountId, amountCents: 100_000n, productId });

    const onAttested = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('mint pipeline down');
      })
      .mockImplementation(() => undefined);
    const { watcher } = makeWatcher({ onAttested });

    // Cycle 1: attestation is committed even though delivery fails.
    expect(await watcher.pollOnce()).toHaveLength(1);
    expect(onAttested).toHaveBeenCalledTimes(1);
    expect((await pool.query('SELECT * FROM attestations')).rowCount).toBe(1);

    // Cycle 2: the SAME attestation is redelivered (no re-signing, no new rows).
    expect(await watcher.pollOnce()).toHaveLength(0);
    expect(onAttested).toHaveBeenCalledTimes(2);
    expect(onAttested.mock.calls[1]![0]).toEqual(onAttested.mock.calls[0]![0]);
    expect(onAttested.mock.calls[1]![0].payload.deposit_id).toBe(String(txId));
    expect((await pool.query('SELECT * FROM attestations')).rowCount).toBe(1);

    // Cycle 3: delivery succeeded, nothing left to retry.
    expect(await watcher.pollOnce()).toHaveLength(0);
    expect(onAttested).toHaveBeenCalledTimes(2);
  });

  it('runs as a poller (start/stop): attests new deposits while running, none after stop', async () => {
    const productId = await seedProduct(pool);
    const accountId = await seedAccount(pool, { did: MEMBER_DID });

    const attested: SignedAttestation[] = [];
    const onAttested = vi.fn((a: SignedAttestation) => {
      attested.push(a);
    });
    const { watcher } = makeWatcher({ onAttested, pollIntervalMs: 50 });
    watcher.start();
    watcher.start(); // no-op double start

    const txId = await seedDeposit(pool, { accountId, amountCents: 100_000n, productId });
    await vi.waitFor(() => expect(attested.map((a) => a.payload.deposit_id)).toContain(String(txId)), {
      timeout: 5000,
    });

    await watcher.stop();
    const callsAfterStop = onAttested.mock.calls.length;

    // a deposit created after stop() must not be attested
    await seedDeposit(pool, { accountId, amountCents: 100_000n, productId });
    await new Promise((r) => setTimeout(r, 300));
    expect(onAttested.mock.calls.length).toBe(callsAfterStop);
    expect((await pool.query('SELECT * FROM attestations')).rowCount).toBe(1);
  });

  it('stop() resolves promptly even mid-sleep on a long poll interval (timer is cleared)', async () => {
    const { watcher } = makeWatcher({ pollIntervalMs: 60_000 });
    watcher.start();
    await new Promise((r) => setTimeout(r, 100)); // let the first cycle finish and the loop enter its sleep
    const begun = Date.now();
    await watcher.stop();
    expect(Date.now() - begun).toBeLessThan(2_000); // woken immediately, not after 60s
  });

  it('start() issued during an un-awaited stop() does not resurrect the old loop or double-attest', async () => {
    const productId = await seedProduct(pool);
    const accountId = await seedAccount(pool, { did: MEMBER_DID });

    const onAttested = vi.fn();
    const { watcher } = makeWatcher({ onAttested, pollIntervalMs: 50 });
    watcher.start();
    const stopping = watcher.stop(); // not awaited yet
    watcher.start(); // restart while the old loop is still winding down
    await stopping;

    const txId = await seedDeposit(pool, { accountId, amountCents: 100_000n, productId });
    await vi.waitFor(
      () => expect(onAttested.mock.calls.map((c) => (c[0] as SignedAttestation).payload.deposit_id)).toContain(String(txId)),
      { timeout: 5000 },
    );
    // exactly one attestation, delivered exactly once, despite the restart race
    await new Promise((r) => setTimeout(r, 200));
    expect(onAttested).toHaveBeenCalledTimes(1);
    expect((await pool.query('SELECT * FROM attestations')).rowCount).toBe(1);
    await watcher.stop();
  });
});

describe('loadConfig env validation', () => {
  it('uses defaults when env vars are unset', () => {
    const cfg = loadConfig({});
    expect(cfg.pg.port).toBe(55433);
    expect(cfg.pollIntervalMs).toBe(5000);
  });

  it('falls back to defaults for empty, non-numeric, or non-positive values', () => {
    expect(loadConfig({ PGPORT: '' }).pg.port).toBe(55433); // Number('') === 0 must not win
    expect(loadConfig({ PGPORT: 'abc' }).pg.port).toBe(55433);
    expect(loadConfig({ POLL_INTERVAL_MS: 'soon' }).pollIntervalMs).toBe(5000); // NaN would busy-loop setTimeout(0)
    expect(loadConfig({ POLL_INTERVAL_MS: '-5' }).pollIntervalMs).toBe(5000);
    expect(loadConfig({ POLL_INTERVAL_MS: '0' }).pollIntervalMs).toBe(5000);
  });

  it('honors valid overrides', () => {
    const cfg = loadConfig({ PGHOST: 'db.internal', PGPORT: '6543', POLL_INTERVAL_MS: '250' });
    expect(cfg.pg.host).toBe('db.internal');
    expect(cfg.pg.port).toBe(6543);
    expect(cfg.pollIntervalMs).toBe(250);
  });
});
