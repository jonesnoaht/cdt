/**
 * CLI entry: `npm start` — run the oracle watcher against an env-configured
 * Postgres.
 *
 * Environment:
 *   PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE  — bank database
 *   POLL_INTERVAL_MS                                    — poll interval (default 5000)
 *   ORACLE_SIGNING_KEY_PEM                              — Ed25519 private key, PKCS#8 PEM.
 *                                                         Required unless ALLOW_EPHEMERAL_ORACLE_KEY=1.
 *   ALLOW_EPHEMERAL_ORACLE_KEY=1                        — generate a throwaway key (lab only).
 *   CDT_VC_MODE                                         — fail_closed | accept_all | credentials
 *   CDT_ORACLE_ACCEPT_ALL_VC=1                          — alias for accept_all (LAB ONLY)
 *   CDT_TRUSTED_ROOT_DID                                — NCUA / root DID for credentials mode
 *   CDT_PRESENTATION_DIR                                — directory of VP JSON files (credentials mode)
 *
 * SECURITY: Never set accept_all outside a lab. Prefer credentials mode with
 * pre-issued presentations or a future Identus agent.
 */
import { createPublicKey } from "node:crypto";
import {
  buildVerifyPresentationHook,
  PresentationDirectory,
  vcModeFromEnv,
} from "./credentials-hook.js";
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
  const trustedRootDid = process.env.CDT_TRUSTED_ROOT_DID || "did:cdt:ncua";
  const directory = new PresentationDirectory();
  if (process.env.CDT_PRESENTATION_DIR) {
    const n = directory.loadDir(process.env.CDT_PRESENTATION_DIR);
    console.log(`oracle-watcher: loaded ${n} presentations from ${process.env.CDT_PRESENTATION_DIR}`);
  }
  console.log(`oracle-watcher: VC mode = ${mode}`);

  const verifyPresentation = buildVerifyPresentationHook({
    mode,
    trustedRootDid,
    directory,
    log: (m) => console.warn(m),
  });

  const pool = createPool(config.pg);
  const watcher = new OracleWatcher({
    pool,
    oraclePrivateKey: privateKey,
    pollIntervalMs: config.pollIntervalMs,
    verifyPresentation,
    onAttested: (attestation) => {
      console.log(
        `oracle-watcher: attestation ready for minting deposit=${attestation.payload.deposit_id} account=${attestation.payload.account_id} hash=${attestation.attestation_hash_hex}:\n${JSON.stringify(
          {
            deposit_id: attestation.payload.deposit_id,
            account_id: attestation.payload.account_id,
            owner_did: attestation.payload.owner_did,
            attestation_hash_hex: attestation.attestation_hash_hex,
            algorithm: attestation.algorithm,
          },
          null,
          2,
        )}`,
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
