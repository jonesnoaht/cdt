/**
 * Off-chain one-shot deposit registry helpers for the issuance pipeline.
 * Best-effort: missing table is a no-op (older bank DBs).
 */
import type { Pool } from "pg";

export async function registryRecordMinted(
  pool: Pool,
  input: {
    depositId: string;
    mintTxHash: string;
    accountId?: string;
    attestationHash?: string;
  },
  log?: { warn: (m: string) => void; info: (m: string) => void },
): Promise<void> {
  try {
    const { rows: existing } = await pool.query(
      `SELECT state, mint_tx_hash FROM deposit_registry WHERE deposit_id = $1`,
      [input.depositId],
    );
    if (existing[0]?.state === "burned") {
      log?.warn?.(
        `pipeline: deposit_registry says ${input.depositId} is burned — recording mint hash anyway is skipped`,
      );
      return;
    }
    if (
      existing[0]?.state === "minted" &&
      existing[0].mint_tx_hash &&
      existing[0].mint_tx_hash !== input.mintTxHash
    ) {
      log?.warn?.(
        `pipeline: deposit ${input.depositId} already minted as ${existing[0].mint_tx_hash}`,
      );
      return;
    }

    await pool.query(
      `INSERT INTO deposit_registry (deposit_id, account_id, attestation_hash, state, mint_tx_hash)
       VALUES ($1, $2, $3, 'minted', $4)
       ON CONFLICT (deposit_id) DO UPDATE SET
         state = 'minted',
         mint_tx_hash = COALESCE(deposit_registry.mint_tx_hash, EXCLUDED.mint_tx_hash),
         account_id = CASE
           WHEN deposit_registry.account_id = '' THEN EXCLUDED.account_id
           ELSE deposit_registry.account_id
         END,
         attestation_hash = CASE
           WHEN deposit_registry.attestation_hash = '' THEN EXCLUDED.attestation_hash
           ELSE deposit_registry.attestation_hash
         END,
         updated_at = now()`,
      [
        input.depositId,
        input.accountId ?? "",
        input.attestationHash ?? "",
        input.mintTxHash,
      ],
    );
    log?.info?.(
      `pipeline: deposit_registry minted deposit=${input.depositId} tx=${input.mintTxHash}`,
    );
  } catch (err) {
    const msg = String(err);
    if (/does not exist|undefined_table/i.test(msg)) {
      log?.warn?.("pipeline: deposit_registry table missing — skip registry write");
      return;
    }
    // Never fail mint write-back for registry races.
    log?.warn?.(`pipeline: deposit_registry mint write failed: ${msg}`);
  }
}

export async function registryAssertMintable(
  pool: Pool,
  depositId: string,
): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT state, mint_tx_hash FROM deposit_registry WHERE deposit_id = $1`,
      [depositId],
    );
    if (rows[0]?.state === "burned") {
      throw new Error(
        `deposit ${depositId} is marked burned in deposit_registry — cannot mint`,
      );
    }
  } catch (err) {
    const msg = String(err);
    if (/does not exist|undefined_table/i.test(msg)) return;
    throw err;
  }
}

/**
 * When ONCHAIN_REGISTRY_REQUIRED=1, refuse mint unless a registry UTxO plan
 * is supplied. Full Lucid co-spend is wired by the builder using
 * `@cdt/txlib` `planRegistryMintCospend`.
 */
export function assertOnchainRegistryPlan(opts: {
  required: boolean;
  plan: unknown | null | undefined;
  depositId: string;
}): void {
  if (!opts.required) return;
  if (!opts.plan) {
    throw new Error(
      `ONCHAIN_REGISTRY_REQUIRED: mint of deposit ${opts.depositId} needs a registry co-spend plan (planRegistryMintCospend + registry UTxO).`,
    );
  }
}
