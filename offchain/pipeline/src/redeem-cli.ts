/**
 * `npm run redeem -- --deposit-id <id> [--early]`
 *
 * Redeems a CD at/after maturity, or early-withdraws it with penalty:
 * looks up the vault UTxO by the CDT asset name, builds the transaction via
 * @cdt/txlib, signs with the member key, submits, and prints the payout
 * breakdown.
 *
 * - emulator mode (default): the chain lives inside the running issuance
 *   service (`npm start`), so the request is sent to its control endpoint
 *   (CDT_SERVICE_URL) — the handler runs the exact same code path.
 * - preview mode: talks to the chain directly; CDT_MEMBER_SK_FILE must
 *   point at the member's bech32 key file.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createPool } from "../../../bank-sim/src/index.ts";
import { loadEnv } from "./env.js";
import { ada } from "./format.js";
import { CredentialDirectory } from "./credentials.js";
import { createChainContext } from "./provider.js";
import { IssuanceService, type RedeemOutcome } from "./service.js";

interface OutcomeLike {
  depositId: string;
  kind: string;
  unit: string;
  txHash: string;
  principal: string | bigint;
  interest: string | bigint;
  penalty: string | bigint;
  payout: string | bigint;
  remainder: string | bigint;
}

function printOutcome(outcome: OutcomeLike): void {
  const early = outcome.kind === "early_withdraw";
  console.log(
    early
      ? `Early withdrawal of deposit ${outcome.depositId} complete.`
      : `Redemption of deposit ${outcome.depositId} complete.`,
  );
  console.log(`  tx hash:    ${outcome.txHash}`);
  console.log(`  CDT burned: ${outcome.unit}`);
  console.log(`  principal:  ${ada(outcome.principal)}`);
  console.log(
    `  interest:   ${ada(outcome.interest)}${early ? " (accrued to date)" : " (full term)"}`,
  );
  if (early) {
    console.log(`  penalty:   -${ada(outcome.penalty)}`);
  }
  console.log(`  payout:     ${ada(outcome.payout)}  -> member`);
  if (early) {
    console.log(`  remainder:  ${ada(outcome.remainder)}  -> issuer`);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "deposit-id": { type: "string" },
      early: { type: "boolean", default: false },
    },
  });
  const depositId = values["deposit-id"];
  if (!depositId) {
    console.error(
      "usage: npm run redeem -- --deposit-id <bank transaction id> [--early]",
    );
    process.exit(2);
  }
  const early = values.early ?? false;
  const env = loadEnv();

  if (env.network === "emulator") {
    // The emulator chain lives inside the issuance service process.
    const res = await fetch(`${env.serviceUrl}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ depositId, early }),
    }).catch(() => {
      throw new Error(
        `cannot reach the issuance service at ${env.serviceUrl} — is \`npm start\` running?`,
      );
    });
    const body = (await res.json()) as OutcomeLike & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    printOutcome(body);
    return;
  }

  const pool = createPool();
  try {
    const chain = await createChainContext(env);
    const service = new IssuanceService({
      pool,
      chain,
      directory: new CredentialDirectory(),
      memberKey: env.memberSkFile
        ? readFileSync(env.memberSkFile, "utf8").trim()
        : undefined,
    });
    const outcome: RedeemOutcome = await service.redeem({ depositId, early });
    printOutcome(outcome);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
