/**
 * CLI entry: `npm start` — run the oracle watcher against an env-configured
 * Postgres.
 *
 * Environment:
 *   PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE  — bank database
 *                                                         (defaults match test/docker-compose.yml, PGPORT 55433)
 *   POLL_INTERVAL_MS                                    — poll interval (default 5000)
 *   ORACLE_SIGNING_KEY_PEM                              — Ed25519 private key, PKCS#8 PEM.
 *                                                         If unset, an EPHEMERAL demo key is generated.
 *
 * NOTE: this standalone CLI uses an accept-all VC verification hook so the
 * demo can run without a credentials service; every decision is logged. Real
 * deployments must inject a real `verifyPresentation` implementation (see
 * `src/vc-mock.ts` for the expected wiring, and `src/watcher.ts` for the
 * hook signature).
 */
import { generateEd25519KeyPair, privateKeyFromPem, privateKeyToPem, publicKeyToBase64 } from './keys.js';
import { createPool, loadConfig } from './config.js';
import { OracleWatcher } from './watcher.js';
import { createPublicKey } from 'node:crypto';

async function main(): Promise<void> {
  const config = loadConfig();

  const pem = process.env.ORACLE_SIGNING_KEY_PEM;
  const privateKey = pem ? privateKeyFromPem(pem) : generateEd25519KeyPair().privateKey;
  if (!pem) {
    console.warn('oracle-watcher: ORACLE_SIGNING_KEY_PEM not set — generated an EPHEMERAL demo signing key:');
    console.warn(privateKeyToPem(privateKey));
  }
  console.log(`oracle-watcher: oracle public key (base64 SPKI): ${publicKeyToBase64(createPublicKey(privateKey))}`);
  console.log(
    `oracle-watcher: polling ${config.pg.host}:${config.pg.port}/${config.pg.database} every ${config.pollIntervalMs}ms`,
  );

  const pool = createPool(config.pg);
  const watcher = new OracleWatcher({
    pool,
    oraclePrivateKey: privateKey,
    pollIntervalMs: config.pollIntervalMs,
    verifyPresentation: (memberDid) => {
      console.warn(`oracle-watcher: DEMO MODE — accepting VC presentation for ${memberDid} without verification`);
      return { verified: true };
    },
    onAttested: (attestation) => {
      // A demo wires this to CDT minting; here we emit the attestation on stdout.
      console.log(`oracle-watcher: attestation ready for minting:\n${JSON.stringify(attestation, null, 2)}`);
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
