import { createPublicKey, type KeyObject } from 'node:crypto';
import type { Pool } from 'pg';
import {
  buildAttestationPayload,
  signAttestation,
  type SignedAttestation,
} from './attestation.js';
import { publicKeyToBase64 } from './keys.js';

/** A candidate deposit row (transactions JOIN accounts JOIN cd_products). */
export interface PendingDeposit {
  transactionId: number;
  accountId: number;
  amountCents: bigint;
  productId: number;
  memberName: string;
  walletAddress: string;
  did: string;
  product: {
    name: string;
    termMonths: number;
    rateBps: number;
    penaltyBps: number;
    minDepositCents: bigint;
  };
}

export type VerifyPresentationResult = { verified: true } | { verified: false; error: string };

/**
 * Pluggable VC hook: given the member DID and the deposit under review,
 * obtain and verify the member's verifiable-credential presentation.
 * Production wires this to a real VC stack; tests wire it to the vendored
 * mock verifier in `vc-mock.ts`.
 */
export type VerifyPresentationHook = (
  memberDid: string,
  deposit: PendingDeposit,
) => Promise<VerifyPresentationResult> | VerifyPresentationResult;

/** Pluggable sink for freshly recorded attestations (a demo wires this to minting). */
export type OnAttestedHook = (attestation: SignedAttestation) => Promise<void> | void;

export interface WatcherLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export interface OracleWatcherOptions {
  pool: Pool;
  oraclePrivateKey: KeyObject;
  verifyPresentation: VerifyPresentationHook;
  onAttested?: OnAttestedHook;
  /** poll interval in ms (default 5000) */
  pollIntervalMs?: number;
  log?: WatcherLogger;
  /** clock override for tests */
  now?: () => number;
}

const PENDING_DEPOSITS_SQL = `
  SELECT t.id            AS transaction_id,
         t.account_id    AS account_id,
         t.amount_cents  AS amount_cents,
         t.product_id    AS product_id,
         a.member_name   AS member_name,
         a.wallet_address AS wallet_address,
         a.did           AS did,
         p.name          AS product_name,
         p.term_months   AS term_months,
         p.rate_bps      AS rate_bps,
         p.penalty_bps   AS penalty_bps,
         p.min_deposit_cents AS min_deposit_cents
    FROM transactions t
    JOIN accounts a    ON a.id = t.account_id
    JOIN cd_products p ON p.id = t.product_id
   WHERE t.kind = 'deposit'
     AND t.attested = false
     AND a.kind = 'cd_funding'
     AND t.product_id IS NOT NULL
   ORDER BY t.id
`;

/**
 * Polls the bank Postgres for unattested CD-funding deposits, validates the
 * product minimum, verifies the member's VC presentation, then — inside a
 * single DB transaction — records the signed attestation and marks the
 * deposit attested.
 *
 * Idempotency: the poll query filters `attested = false`, the UPDATE is
 * conditional (`WHERE attested = false`), and `attestations.transaction_id`
 * is UNIQUE. If an attestation row already exists for a deposit that is
 * somehow still flagged unattested (external mutation / partial repair), the
 * watcher reconciles by marking the deposit attested WITHOUT inserting or
 * signing a second attestation. A deposit can never be double-attested.
 *
 * Delivery semantics for `onAttested`: the attestation is committed to the
 * DB first, then delivered. If the hook throws, delivery is retried at the
 * start of every subsequent poll cycle (at-least-once within the process
 * lifetime). Across restarts, undelivered attestations must be reconciled
 * from the `attestations` table by the consumer.
 */
export class OracleWatcher {
  private readonly pool: Pool;
  private readonly oraclePrivateKey: KeyObject;
  private readonly oraclePublicKeyB64: string;
  private readonly verifyPresentation: VerifyPresentationHook;
  private readonly onAttested: OnAttestedHook | undefined;
  private readonly pollIntervalMs: number;
  private readonly log: WatcherLogger;
  private readonly now: () => number;

  private running = false;
  /** bumped on every start/stop so stale loops exit even across restart races */
  private generation = 0;
  private loopPromise: Promise<void> | null = null;
  private wakeUp: (() => void) | null = null;
  /** transaction ids already reported as skipped, to avoid log spam across polls */
  private skipLogged = new Set<number>();
  /** attestations whose onAttested delivery failed; retried each poll cycle */
  private readonly redeliveryQueue: SignedAttestation[] = [];

  constructor(opts: OracleWatcherOptions) {
    this.pool = opts.pool;
    this.oraclePrivateKey = opts.oraclePrivateKey;
    this.oraclePublicKeyB64 = publicKeyToBase64(createPublicKey(opts.oraclePrivateKey));
    this.verifyPresentation = opts.verifyPresentation;
    this.onAttested = opts.onAttested;
    this.pollIntervalMs = opts.pollIntervalMs ?? 5000;
    this.log = opts.log ?? console;
    this.now = opts.now ?? Date.now;
  }

  /** Run a single poll cycle; returns the attestations recorded this cycle. */
  async pollOnce(): Promise<SignedAttestation[]> {
    await this.retryFailedDeliveries();
    const { rows } = await this.pool.query(PENDING_DEPOSITS_SQL);
    const recorded: SignedAttestation[] = [];
    const pendingIds = new Set<number>();
    for (const row of rows) {
      const deposit = toPendingDeposit(row);
      pendingIds.add(deposit.transactionId);
      try {
        const attestation = await this.processDeposit(deposit);
        if (attestation) recorded.push(attestation);
      } catch (err) {
        this.log.error(`oracle-watcher: error processing deposit tx=${deposit.transactionId}: ${String(err)}`);
      }
    }
    // Prune skip-log dedup entries for deposits that are no longer pending,
    // so the set stays bounded by the size of the pending queue.
    this.skipLogged = new Set([...this.skipLogged].filter((id) => pendingIds.has(id)));
    return recorded;
  }

  private async processDeposit(deposit: PendingDeposit): Promise<SignedAttestation | null> {
    const txId = deposit.transactionId;

    if (deposit.amountCents < deposit.product.minDepositCents) {
      this.skipOnce(
        txId,
        `deposit tx=${txId} amount ${deposit.amountCents}c is below product "${deposit.product.name}" minimum ${deposit.product.minDepositCents}c — skipping`,
      );
      return null;
    }

    const vc = await this.verifyPresentation(deposit.did, deposit);
    if (!vc.verified) {
      this.skipOnce(txId, `deposit tx=${txId} VC presentation for ${deposit.did} failed verification: ${vc.error} — skipping`);
      return null;
    }

    const payload = buildAttestationPayload({
      transactionId: txId,
      walletAddress: deposit.walletAddress,
      amountCents: deposit.amountCents,
      rateBps: deposit.product.rateBps,
      penaltyBps: deposit.product.penaltyBps,
      termMonths: deposit.product.termMonths,
      now: this.now(),
    });
    const signed = signAttestation(payload, this.oraclePrivateKey, this.oraclePublicKeyB64);

    const client = await this.pool.connect();
    let committed = false;
    let inserted = false;
    try {
      await client.query('BEGIN');
      const marked = await client.query(
        `UPDATE transactions SET attested = true WHERE id = $1 AND attested = false RETURNING id`,
        [txId],
      );
      if (marked.rowCount !== 1) {
        // Another watcher marked it between our SELECT and now.
        this.log.info(`oracle-watcher: deposit tx=${txId} was attested concurrently — skipping`);
        return null; // finally rolls back
      }
      const insertResult = await client.query(
        `INSERT INTO attestations (transaction_id, deposit_id, payload)
         VALUES ($1, $2, $3)
         ON CONFLICT (transaction_id) DO NOTHING
         RETURNING id`,
        [txId, payload.deposit_id, JSON.stringify(signed)],
      );
      inserted = insertResult.rowCount === 1;
      if (!inserted) {
        // An attestation row already exists (external mutation left
        // attested=false). Keep the UPDATE so the state converges instead of
        // re-signing this deposit forever; do NOT record or deliver a new
        // attestation.
        this.log.warn(`oracle-watcher: attestation for tx=${txId} already exists — reconciling attested flag only`);
      }
      await client.query('COMMIT');
      committed = true;
    } finally {
      if (!committed) {
        // Make sure a throw mid-transaction doesn't leak an open tx back to the pool.
        await client.query('ROLLBACK').catch(() => {});
      }
      client.release();
    }
    if (!inserted) return null;

    this.log.info(
      `oracle-watcher: attested deposit tx=${txId} (owner=${payload.owner}, principal=${payload.principal} lovelace)`,
    );
    await this.deliver(signed);
    return signed;
  }

  /** Deliver to onAttested; on failure, queue for retry on the next poll cycle. */
  private async deliver(signed: SignedAttestation): Promise<void> {
    if (!this.onAttested) return;
    try {
      await this.onAttested(signed);
    } catch (err) {
      this.redeliveryQueue.push(signed);
      this.log.error(
        `oracle-watcher: onAttested callback failed for deposit ${signed.payload.deposit_id} (will retry next poll): ${String(err)}`,
      );
    }
  }

  private async retryFailedDeliveries(): Promise<void> {
    if (this.redeliveryQueue.length === 0) return;
    const pending = this.redeliveryQueue.splice(0);
    for (const signed of pending) {
      await this.deliver(signed);
    }
  }

  private skipOnce(txId: number, message: string): void {
    if (!this.skipLogged.has(txId)) {
      this.skipLogged.add(txId);
      this.log.warn(`oracle-watcher: ${message}`);
    }
  }

  /** Start the poll loop. No-op if already running. */
  start(): void {
    if (this.running) return;
    this.running = true;
    const gen = ++this.generation;
    this.loopPromise = this.loop(gen);
  }

  private async loop(gen: number): Promise<void> {
    while (this.running && gen === this.generation) {
      try {
        await this.pollOnce();
      } catch (err) {
        this.log.error(`oracle-watcher: poll cycle failed: ${String(err)}`);
      }
      if (!this.running || gen !== this.generation) break;
      await this.sleepInterval();
    }
  }

  private async sleepInterval(): Promise<void> {
    await new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer); // don't hold the event loop open after wake/stop
        if (this.wakeUp === done) this.wakeUp = null;
        resolve();
      };
      const timer = setTimeout(done, this.pollIntervalMs);
      this.wakeUp = done;
    });
  }

  /** Stop polling; resolves once the in-flight cycle (if any) has finished. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    // Invalidate the current loop generation so a start() issued while this
    // stop() is still awaited cannot resurrect the old loop (it gets a fresh
    // generation and its own loop promise instead).
    this.generation++;
    this.wakeUp?.();
    const finished = this.loopPromise;
    await finished;
    if (this.loopPromise === finished) this.loopPromise = null;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toPendingDeposit(row: any): PendingDeposit {
  return {
    transactionId: Number(row.transaction_id),
    accountId: Number(row.account_id),
    amountCents: BigInt(row.amount_cents), // pg returns BIGINT as string
    productId: Number(row.product_id),
    memberName: String(row.member_name),
    walletAddress: String(row.wallet_address),
    did: String(row.did),
    product: {
      name: String(row.product_name),
      termMonths: Number(row.term_months),
      rateBps: Number(row.rate_bps),
      penaltyBps: Number(row.penalty_bps),
      minDepositCents: BigInt(row.min_deposit_cents),
    },
  };
}
