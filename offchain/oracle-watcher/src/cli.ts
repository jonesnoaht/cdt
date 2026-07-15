/**
 * CLI entry: `npm start` — run the oracle watcher against an env-configured
 * Postgres.
 *
 * Environment:
 *   PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE
 *   POLL_INTERVAL_MS
 *   ORACLE_SIGNING_KEY_PEM          — required unless ALLOW_EPHEMERAL_ORACLE_KEY=1
 *   CDT_VC_MODE                     — fail_closed | accept_all | credentials
 *   CDT_ORACLE_ACCEPT_ALL_VC=1      — alias for accept_all (LAB ONLY)
 *
 * credentials mode enrolls every accounts.did with a full NCUA→CU→member
 * chain (@cdt/credentials) and verifies a fresh presentation per poll.
 */
import { createPublicKey } from "node:crypto";
import {
  BankCredentialDirectory,
  verifyHookForMode,
} from "./bank-credentials.js";
import { vcModeFromEnv } from "./credentials-hook.js";
import { generateEd25519KeyPair, privateKeyFromPem, publicKeyToBase64 } from "./keys.js";
import { createPool, loadConfig } from "./config.js";
import { OracleWatcher } from "./watcher.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const pem = process.env.ORACLE_SIGNING_KEY_PEM;
  const allowEphemeral = process.env.ALLOW_EPHEMERAL_ORACLE_KEY === "1";
  if (!pem && !allowEphemeral) {
    console.error(
      "oracle-watcher: ORACLE_SIGNING_KEY_PEM is required (set ALLOW_EPHEMERAL_ORACLE_KEY=1 only for local lab demos).",
    );
    process.exit(1);
  }
  const privateKey = pem ? privateKeyFromPem(pem) : generateEd25519KeyPair().privateKey;
  if (!pem) {
    console.warn(
      "oracle-watcher: ALLOW_EPHEMERAL_ORACLE_KEY=1 — generated a throwaway signing key (public only logged).",
    );
  }
  const pubB64 = publicKeyToBase64(createPublicKey(privateKey));
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
    oraclePrivateKey: privateKey,
    pollIntervalMs: config.pollIntervalMs,
    verifyPresentation,
    onAttested: (attestation) => {
      console.log(
        `oracle-watcher: attestation ready deposit=${attestation.payload.deposit_id} account=${attestation.payload.account_id} hash=${attestation.attestation_hash_hex}`,
      );
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
