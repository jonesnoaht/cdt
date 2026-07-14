/**
 * `npm start` — run the CDT issuance service.
 *
 * Connects to the bank-sim Postgres (PGHOST/PGPORT/..., defaults
 * localhost:55432 bank/bank/bank_sim), builds the chain context from the
 * environment (emulator by default), performs the boot credential ceremony,
 * and starts the oracle watcher wired to on-chain minting. A JSON control
 * endpoint (default http://127.0.0.1:8787) serves the status/redeem CLIs.
 */
import { readFileSync } from "node:fs";
import { createPool } from "../../../bank-sim/src/index.ts";
import { loadEnv } from "./env.js";
import { createChainContext } from "./provider.js";
import { CredentialDirectory } from "./credentials.js";
import { IssuanceService } from "./service.js";
import { createControlServer } from "./server.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = createPool();
  const chain = await createChainContext(env);
  const directory = new CredentialDirectory();
  const service = new IssuanceService({
    pool,
    chain,
    directory,
    pollIntervalMs: env.pollIntervalMs,
    maxMintAttempts: env.maxMintAttempts,
    memberKey: env.memberSkFile
      ? readFileSync(env.memberSkFile, "utf8").trim()
      : undefined,
  });

  console.log(`CDT issuance service`);
  console.log(`  mode:           ${chain.mode} (${chain.network})`);
  console.log(`  policy id:      ${chain.scripts.policyId}`);
  console.log(`  vault address:  ${chain.scripts.vaultAddress}`);
  console.log(`  issuer address: ${chain.issuer.address}`);
  console.log(`  oracle vkh:     ${chain.oracle.vkh}`);

  await service.boot();
  service.watcher.start();
  const server = createControlServer(service, chain);
  await new Promise<void>((resolve) =>
    server.listen(env.servicePort, "127.0.0.1", resolve),
  );
  console.log(`  control:        http://127.0.0.1:${env.servicePort}`);
  console.log("watching for CD deposits… (ctrl-c to stop)");

  const shutdown = async (): Promise<void> => {
    console.log("\nshutting down…");
    await service.watcher.stop();
    server.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
