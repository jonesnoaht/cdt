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
 *   CDT_ORACLE_ACCEPT_ALL_VC=1                          — DEMO ONLY: accept any VC presentation.
 *                                                         Default is fail-closed (reject all
 *                                                         presentations until a real verifier is wired).
 *
 * SECURITY: Never set CDT_ORACLE_ACCEPT_ALL_VC or ALLOW_EPHEMERAL_ORACLE_KEY outside a lab.
 */
import { generateEd25519KeyPair, privateKeyFromPem, publicKeyToBase64 } from './keys.js';
import { createPool, loadConfig } from './config.js';
import { OracleWatcher } from './watcher.js';
import { createPublicKey } from 'node:crypto';

async function main(): Promise<void> {
  const config = loadConfig();

  const pem = process.env.ORACLE_SIGNING_KEY_PEM;
  const allowEphemeral = process.env.ALLOW_EPHEMERAL_ORACLE_KEY === '1';
  if (!pem && !allowEphemeral) {
    console.error(
      'oracle-watcher: ORACLE_SIGNING_KEY_PEM is required (set ALLOW_EPHEMERAL_ORACLE_KEY=1 only for local lab demos).',
    );
    process.exit(1);
  }
  const privateKey = pem ? privateKeyFromPem(pem) : generateEd25519KeyPair().privateKey;
  if (!pem) {
    console.warn(
      'oracle-watcher: ALLOW_EPHEMERAL_ORACLE_KEY=1 — generated a throwaway signing key (public only logged).',
    );
  }
  const pubB64 = publicKeyToBase64(createPublicKey(privateKey));
  console.log(`oracle-watcher: oracle public key (base64 SPKI): ${pubB64}`);
  console.log(
    `oracle-watcher: polling ${config.pg.host}:${config.pg.port}/${config.pg.database} every ${config.pollIntervalMs}ms`,
  );

  const acceptAllVc = process.env.CDT_ORACLE_ACCEPT_ALL_VC === '1';
  if (acceptAllVc) {
    console.warn(
      'oracle-watcher: CDT_ORACLE_ACCEPT_ALL_VC=1 — accepting ALL presentations without verification (LAB ONLY).',
    );
  } else {
    console.log(
      'oracle-watcher: VC verification is fail-closed (presentations rejected until a real VerifyPresentationHook is configured).',
    );
  }

  const pool = createPool(config.pg);
  const watcher = new OracleWatcher({
    pool,
    oraclePrivateKey: privateKey,
    pollIntervalMs: config.pollIntervalMs,
    verifyPresentation: (memberDid) => {
      if (acceptAllVc) {
        console.warn(
          `oracle-watcher: DEMO MODE — accepting VC presentation for ${memberDid} without verification`,
        );
        return { verified: true };
      }
      return {
        verified: false,
        error:
          'no VerifyPresentationHook configured; set CDT_ORACLE_ACCEPT_ALL_VC=1 only for lab demos, or wire Identus/@cdt/credentials',
      };
    },
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
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  watcher.start();
}

main().catch((err) => {
  console.error(`oracle-watcher: fatal: ${String(err)}`);
  process.exit(1);
});
