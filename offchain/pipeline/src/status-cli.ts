/**
 * `npm run status` — list every CD: the bank DB's attestations joined with
 * the on-chain vault state (awaiting attestation / mint pending / minted /
 * matured / redeemed).
 *
 * In emulator mode the rows come from the running issuance service's
 * control endpoint (the chain lives in that process); in preview mode the
 * chain is queried directly.
 */
import { createPool } from "../../../bank-sim/src/index.ts";
import { loadEnv } from "./env.js";
import { ada, renderTable, shortHash, tsToIso } from "./format.js";
import { CredentialDirectory } from "./credentials.js";
import { createChainContext } from "./provider.js";
import { IssuanceService, type StatusRow } from "./service.js";

interface StatusRowLike extends Omit<StatusRow, "principal"> {
  principal: string | bigint;
}

function printRows(rows: StatusRowLike[]): void {
  if (rows.length === 0) {
    console.log("No CD deposits found in the bank database.");
    return;
  }
  console.log(
    renderTable(
      ["deposit", "member", "product", "principal", "rate", "maturity", "mint tx", "state"],
      rows.map((r) => [
        r.depositId,
        r.member,
        r.product ?? "—",
        ada(r.principal),
        `${(r.rateBps / 100).toFixed(2)}%`,
        tsToIso(r.maturity),
        shortHash(r.mintTxHash),
        r.state,
      ]),
    ),
  );
}

async function main(): Promise<void> {
  const env = loadEnv();

  if (env.network === "emulator") {
    const res = await fetch(`${env.serviceUrl}/status`).catch(() => {
      throw new Error(
        `cannot reach the issuance service at ${env.serviceUrl} — is \`npm start\` running?`,
      );
    });
    const body = (await res.json()) as StatusRowLike[] | { error: string };
    if (!res.ok || !Array.isArray(body)) {
      throw new Error(!Array.isArray(body) ? body.error : `HTTP ${res.status}`);
    }
    printRows(body);
    return;
  }

  const pool = createPool();
  try {
    const chain = await createChainContext(env);
    const service = new IssuanceService({
      pool,
      chain,
      directory: new CredentialDirectory(),
    });
    printRows(await service.status());
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
