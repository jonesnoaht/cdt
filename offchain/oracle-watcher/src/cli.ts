/**
 * CLI entry: `npm start` — run the oracle watcher against an env-configured
 * Postgres.
 *
 * Environment:
 *   PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE
 *   POLL_INTERVAL_MS
 *   ORACLE_SIGNING_KEY_PEM          — required unless ALLOW_EPHEMERAL_ORACLE_KEY=1
 *   ORACLE_SIGNING_PROVIDER         — pem (default) | remote | hsm (stub)
 *   ORACLE_REMOTE_SIGNER_URL        — when provider=remote
 *   CDT_VC_MODE                     — fail_closed | accept_all | credentials
 *   CDT_ORACLE_ACCEPT_ALL_VC=1      — alias for accept_all (LAB ONLY)
 *
 * credentials mode enrolls every accounts.did with a full NCUA→CU→member
 * chain (@cdt/credentials) and verifies a fresh presentation per poll.
 */
import {
  BankCredentialDirectory,
  verifyHookForMode,
} from "./bank-credentials.js";
import { vcModeFromEnv } from "./credentials-hook.js";
import { createPool, loadConfig } from "./config.js";
import { signingProviderFromEnv } from "./signing-provider.js";
import { OracleWatcher } from "./watcher.js";

async function main(): Promise<void> {
  const config = loadConfig();

  let signer;
  try {
    signer = signingProviderFromEnv();
  } catch (err) {
    console.error(`oracle-watcher: ${String(err)}`);
    process.exit(1);
  }

  if (signer.kind === "ephemeral") {
    console.warn(
      "oracle-watcher: ALLOW_EPHEMERAL_ORACLE_KEY=1 — throwaway signing key (public only logged).",
    );
  }
  if (signer.kind === "hsm") {
    console.error(
      "oracle-watcher: HSM PKCS#11 provider selected but not implemented — use ORACLE_SIGNING_PROVIDER=remote for an HSM sidecar.",
    );
    process.exit(1);
  }

  // Remote needs a pin or one warm-up sign to learn the public key.
  if (signer.kind === "remote") {
    try {
      signer.publicKeySpkiBase64();
    } catch {
      await signer.signUtf8Message("oracle-watcher-pubkey-probe");
    }
  }

  const pubB64 = signer.publicKeySpkiBase64();
  console.log(`oracle-watcher: signing provider = ${signer.kind}`);
  console.log(`oracle-watcher: oracle public key (base64 SPKI): ${pubB64}`);
  console.log(
    `oracle-watcher: polling ${config.pg.host}:${config.pg.port}/${config.pg.database} every ${config.pollIntervalMs}ms`,
  );

  const mode = vcModeFromEnv();
  const pool = createPool(config.pg);

  let directory: BankCredentialDirectory | undefined;
  if (mode === "credentials") {
    directory = new BankCredentialDirectory();
    const n = await directory.enrollFromAccounts(pool);
    console.log(
      `oracle-watcher: CDT_VC_MODE=credentials — enrolled ${n} new member DID(s) (total ${directory.size()}); root=${directory.trustedRootDid()}`,
    );
  } else {
    console.log(`oracle-watcher: VC mode = ${mode}`);
  }

  const verifyPresentation = verifyHookForMode(mode, directory, (m) =>
    console.warn(m),
  );

  const watcher = new OracleWatcher({
    pool,
    signingProvider: signer,
    oraclePrivateKey: signer.privateKeyObject?.(),
    pollIntervalMs: config.pollIntervalMs,
    verifyPresentation,
    onAttested: async (attestation) => {
      console.log(
        `oracle-watcher: attestation ready deposit=${attestation.payload.deposit_id} account=${attestation.payload.account_id} hash=${attestation.attestation_hash_hex}`,
      );
      try {
        await pool.query(
          `INSERT INTO deposit_registry (deposit_id, account_id, attestation_hash, state)
           VALUES ($1, $2, $3, 'attested')
           ON CONFLICT (deposit_id) DO UPDATE SET
             account_id = EXCLUDED.account_id,
             attestation_hash = CASE
               WHEN deposit_registry.attestation_hash = '' THEN EXCLUDED.attestation_hash
               ELSE deposit_registry.attestation_hash
             END,
             updated_at = now()
           WHERE deposit_registry.state <> 'burned'`,
          [
            attestation.payload.deposit_id,
            attestation.payload.account_id,
            attestation.attestation_hash_hex,
          ],
        );
      } catch (err) {
        if (!/does not exist|undefined_table/i.test(String(err))) {
          console.warn(
            `oracle-watcher: deposit_registry write failed: ${String(err)}`,
          );
        }
      }
    },
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`oracle-watcher: received ${signal}, shutting down...`);
    await watcher.stop();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  watcher.start();
}

main().catch((err) => {
  console.error(`oracle-watcher: fatal: ${String(err)}`);
  process.exit(1);
});
