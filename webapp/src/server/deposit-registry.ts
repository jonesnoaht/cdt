/**
 * Off-chain one-shot deposit registry (pilot stand-in for a global on-chain registry).
 *
 * Lifecycle: attested → minted → burned
 * Enforces UNIQUE deposit_id, optional unique mint/burn tx hashes.
 */
import type pg from "pg";

export type DepositRegistryState = "attested" | "minted" | "burned";

export interface DepositRegistryRow {
  depositId: string;
  accountId: string;
  attestationHash: string;
  state: DepositRegistryState;
  mintTxHash: string | null;
  burnTxHash: string | null;
  presentmentId: number | null;
  createdAt: string;
  updatedAt: string;
}

function rowToDto(row: Record<string, unknown>): DepositRegistryRow {
  return {
    depositId: String(row.deposit_id),
    accountId: String(row.account_id ?? ""),
    attestationHash: String(row.attestation_hash ?? ""),
    state: row.state as DepositRegistryState,
    mintTxHash: row.mint_tx_hash != null ? String(row.mint_tx_hash) : null,
    burnTxHash: row.burn_tx_hash != null ? String(row.burn_tx_hash) : null,
    presentmentId: row.presentment_id != null ? Number(row.presentment_id) : null,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    updatedAt: new Date(row.updated_at as string | Date).toISOString(),
  };
}

export class DepositRegistry {
  private available = false;
  private memory = new Map<string, DepositRegistryRow>();

  constructor(private readonly pool?: pg.Pool) {}

  async init(): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query("SELECT 1 FROM deposit_registry LIMIT 0");
      this.available = true;
    } catch {
      this.available = false;
    }
  }

  isAvailable(): boolean {
    return this.available || !this.pool;
  }

  async get(depositId: string): Promise<DepositRegistryRow | undefined> {
    if (this.available && this.pool) {
      const { rows } = await this.pool.query(
        `SELECT * FROM deposit_registry WHERE deposit_id = $1`,
        [depositId],
      );
      return rows[0] ? rowToDto(rows[0]) : undefined;
    }
    return this.memory.get(depositId);
  }

  /**
   * Record attestation (idempotent if already attested/minted with same hash).
   * Fails if deposit already burned or minted with a different hash.
   */
  async recordAttested(input: {
    depositId: string;
    accountId: string;
    attestationHash: string;
  }): Promise<DepositRegistryRow | { error: string; status: number }> {
    const existing = await this.get(input.depositId);
    if (existing) {
      if (existing.state === "burned") {
        return { error: "Deposit already burned; cannot re-attest.", status: 409 };
      }
      if (
        existing.attestationHash &&
        existing.attestationHash !== input.attestationHash &&
        existing.attestationHash !== ""
      ) {
        return { error: "Deposit already registered with a different attestation hash.", status: 409 };
      }
      return existing;
    }
    const now = new Date().toISOString();
    const row: DepositRegistryRow = {
      depositId: input.depositId,
      accountId: input.accountId,
      attestationHash: input.attestationHash,
      state: "attested",
      mintTxHash: null,
      burnTxHash: null,
      presentmentId: null,
      createdAt: now,
      updatedAt: now,
    };
    if (this.available && this.pool) {
      try {
        const { rows } = await this.pool.query(
          `INSERT INTO deposit_registry (deposit_id, account_id, attestation_hash, state)
           VALUES ($1, $2, $3, 'attested')
           ON CONFLICT (deposit_id) DO UPDATE SET
             account_id = EXCLUDED.account_id,
             attestation_hash = CASE
               WHEN deposit_registry.attestation_hash = '' THEN EXCLUDED.attestation_hash
               ELSE deposit_registry.attestation_hash
             END,
             updated_at = now()
           RETURNING *`,
          [input.depositId, input.accountId, input.attestationHash],
        );
        return rowToDto(rows[0]);
      } catch (err) {
        return { error: String(err), status: 409 };
      }
    }
    this.memory.set(input.depositId, row);
    return row;
  }

  async recordMinted(input: {
    depositId: string;
    mintTxHash: string;
    accountId?: string;
    attestationHash?: string;
  }): Promise<DepositRegistryRow | { error: string; status: number }> {
    const existing = await this.get(input.depositId);
    if (existing?.state === "burned") {
      return { error: "Deposit already burned; cannot mint.", status: 409 };
    }
    if (existing?.state === "minted") {
      if (existing.mintTxHash === input.mintTxHash) return existing;
      return { error: "Deposit already minted with a different tx.", status: 409 };
    }
    if (this.available && this.pool) {
      try {
        if (!existing) {
          const { rows } = await this.pool.query(
            `INSERT INTO deposit_registry (deposit_id, account_id, attestation_hash, state, mint_tx_hash)
             VALUES ($1, $2, $3, 'minted', $4)
             RETURNING *`,
            [
              input.depositId,
              input.accountId ?? "",
              input.attestationHash ?? "",
              input.mintTxHash,
            ],
          );
          return rowToDto(rows[0]);
        }
        const { rows } = await this.pool.query(
          `UPDATE deposit_registry
              SET state = 'minted', mint_tx_hash = $2, updated_at = now()
            WHERE deposit_id = $1 AND state IN ('attested', 'minted')
            RETURNING *`,
          [input.depositId, input.mintTxHash],
        );
        if (!rows[0]) {
          return { error: "Deposit not in mintable state.", status: 409 };
        }
        return rowToDto(rows[0]);
      } catch (err) {
        const msg = String(err);
        if (/unique|duplicate/i.test(msg)) {
          return { error: "Mint tx or deposit already registered.", status: 409 };
        }
        return { error: msg, status: 500 };
      }
    }
    const now = new Date().toISOString();
    const row: DepositRegistryRow = {
      depositId: input.depositId,
      accountId: input.accountId ?? existing?.accountId ?? "",
      attestationHash: input.attestationHash ?? existing?.attestationHash ?? "",
      state: "minted",
      mintTxHash: input.mintTxHash,
      burnTxHash: null,
      presentmentId: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.memory.set(input.depositId, row);
    return row;
  }

  async recordBurned(input: {
    depositId: string;
    burnTxHash: string;
    presentmentId?: number;
  }): Promise<DepositRegistryRow | { error: string; status: number }> {
    const existing = await this.get(input.depositId);
    if (existing?.state === "burned") {
      if (existing.burnTxHash === input.burnTxHash) return existing;
      return { error: "Deposit already burned with a different tx.", status: 409 };
    }
    if (this.available && this.pool) {
      try {
        if (!existing) {
          const { rows } = await this.pool.query(
            `INSERT INTO deposit_registry (deposit_id, state, burn_tx_hash, presentment_id)
             VALUES ($1, 'burned', $2, $3)
             RETURNING *`,
            [input.depositId, input.burnTxHash, input.presentmentId ?? null],
          );
          return rowToDto(rows[0]);
        }
        const { rows } = await this.pool.query(
          `UPDATE deposit_registry
              SET state = 'burned',
                  burn_tx_hash = $2,
                  presentment_id = COALESCE($3, presentment_id),
                  updated_at = now()
            WHERE deposit_id = $1 AND state <> 'burned'
            RETURNING *`,
          [input.depositId, input.burnTxHash, input.presentmentId ?? null],
        );
        if (!rows[0]) {
          return { error: "Deposit already burned or missing.", status: 409 };
        }
        return rowToDto(rows[0]);
      } catch (err) {
        const msg = String(err);
        if (/unique|duplicate/i.test(msg)) {
          return { error: "Burn tx already registered to another deposit.", status: 409 };
        }
        return { error: msg, status: 500 };
      }
    }
    const now = new Date().toISOString();
    const row: DepositRegistryRow = {
      depositId: input.depositId,
      accountId: existing?.accountId ?? "",
      attestationHash: existing?.attestationHash ?? "",
      state: "burned",
      mintTxHash: existing?.mintTxHash ?? null,
      burnTxHash: input.burnTxHash,
      presentmentId: input.presentmentId ?? existing?.presentmentId ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.memory.set(input.depositId, row);
    return row;
  }
}
