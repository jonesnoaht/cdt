/**
 * Repeatable end-to-end smoke test: `npm run smoke`.
 *
 * Brings up the dockerized test Postgres (port 55435), seeds fixture data,
 * starts the real API server (`src/server/main.ts`) as a child process
 * against it, curls every GET endpoint plus one POST, asserts sane JSON,
 * and always tears the database down (-v).
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import pg from "pg";
import { seedFixture } from "../test/fixtures/seed.js";

const COMPOSE = ["compose", "-f", "test/docker-compose.yml"];
const PORT = Number(process.env.SMOKE_PORT || 8788);
const BASE = `http://127.0.0.1:${PORT}`;

function compose(...args: string[]): void {
  execFileSync("docker", [...COMPOSE, ...args], { stdio: "inherit" });
}

function curl(method: string, path: string, body?: unknown): unknown {
  const args = ["-sS", "--max-time", "15", "-X", method, `${BASE}${path}`];
  if (body !== undefined) {
    args.push("-H", "content-type: application/json", "-d", JSON.stringify(body));
  }
  const out = execFileSync("curl", args, { encoding: "utf8" });
  return JSON.parse(out);
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`SMOKE FAIL: ${message}`);
}

function pass(message: string): void {
  console.log(`PASS ${message}`);
}

/** Start the API server child and wait until /api/health answers. */
async function startServer(): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "src/server/main.ts"],
    {
      env: {
        ...process.env,
        PGHOST: "127.0.0.1",
        PGPORT: "55435",
        PGUSER: "bank",
        PGPASSWORD: "bank",
        PGDATABASE: "bank_sim",
        PORT: String(PORT),
      },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`SMOKE FAIL: api server exited early (code ${child.exitCode})`);
    }
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error("SMOKE FAIL: api server did not become healthy within 30s");
}

let exitCode = 0;
compose("up", "-d", "--wait");
const pool = new pg.Pool({
  host: "127.0.0.1",
  port: 55435,
  user: "bank",
  password: "bank",
  database: "bank_sim",
});
let server: ChildProcess | undefined;
try {
  const fx = await seedFixture(pool);
  server = await startServer();
  console.log(`smoke: api on ${BASE} against test db :55435`);

  const products = curl("GET", "/api/products") as Array<Record<string, unknown>>;
  assert(Array.isArray(products) && products.length === 2, "products: expected 2 products");
  assert(typeof products[0]!.apyPercent === "number", "products: apyPercent missing");
  pass(`GET /api/products (${products.length} products, APY ${products[0]!.apyPercent}%)`);

  const accounts = curl("GET", `/api/members/${fx.ada.memberId}/accounts`) as Array<
    Record<string, unknown>
  >;
  assert(accounts.length === 2, "accounts: expected checking + cd_funding");
  assert(accounts.every((a) => typeof a.balanceCents === "number"), "accounts: balances missing");
  pass(`GET /api/members/${fx.ada.memberId}/accounts (${accounts.length} accounts)`);

  const cds = curl("GET", `/api/members/${fx.ada.memberId}/cds`) as Array<Record<string, unknown>>;
  assert(cds.length === 3, "cds: expected 3 certificates");
  const statuses = new Set(cds.map((cd) => cd.status));
  assert(
    statuses.has("pending") && statuses.has("active") && statuses.has("matured"),
    `cds: expected all three statuses, got ${[...statuses].join(",")}`,
  );
  assert(
    cds.every((cd) => typeof cd.maturityValueCents === "number"),
    "cds: maturityValueCents missing",
  );
  pass(`GET /api/members/${fx.ada.memberId}/cds (statuses: ${[...statuses].sort().join(", ")})`);

  const chain = curl("GET", `/api/cds/${fx.cds.activeTxId}/chain`) as Record<string, unknown>;
  assert(chain.available === false, "chain: expected available:false without CHAIN_PROVIDER");
  pass(`GET /api/cds/${fx.cds.activeTxId}/chain (available: false — offline mode)`);

  const prep = curl("GET", `/api/members/${fx.ada.memberId}/tokenize-prep`) as Record<
    string,
    unknown
  >;
  assert(prep.hasCdFunding === true, "tokenize-prep: expected CD funding account");
  assert(Array.isArray(prep.checks) && (prep.checks as unknown[]).length >= 5, "tokenize-prep: checks");
  assert(
    Array.isArray(prep.amountPresetsCents) &&
      (prep.amountPresetsCents as number[]).includes(250_000_00),
    "tokenize-prep: $250k preset",
  );
  pass(`GET /api/members/${fx.ada.memberId}/tokenize-prep (bank desk checklist ready)`);

  const claim = curl("GET", `/api/claims/${fx.cds.activeTxId}`) as Record<string, unknown>;
  assert(claim.redeemable === true, "claims: active CD should be redeemable");
  assert(claim.holderName === "Ada Lovelace", "claims: holder name");
  pass(`GET /api/claims/${fx.cds.activeTxId} (foreign claim lookup)`);

  const presentment = curl("POST", "/api/presentments", {
    claimRef: String(fx.cds.maturedTxId),
    walkInName: "Ada Lovelace",
    presentingCuName: "Gulfside Credit Union",
    checks: { cip: true, ofac: true, ownershipProof: true },
  }) as Record<string, unknown>;
  assert(typeof presentment.id === "number", "presentment: id");
  assert(presentment.status === "cash_advanced_pending_settlement", "presentment: status");
  pass(`POST /api/presentments (#${presentment.id} cash advanced, pending issuer settlement)`);

  const deposit = curl("POST", `/api/members/${fx.grace.memberId}/deposits`, {
    productId: fx.products.twelveMonth,
    amountCents: 200_000,
  }) as Record<string, unknown>;
  assert(typeof deposit.transactionId === "number", "deposit: transactionId missing");
  assert(deposit.status === "pending", "deposit: expected pending status");
  const graceCds = curl("GET", `/api/members/${fx.grace.memberId}/cds`) as Array<
    Record<string, unknown>
  >;
  assert(
    graceCds.length === 1 && graceCds[0]!.status === "pending",
    "deposit: not visible as pending CD",
  );
  pass(`POST /api/members/${fx.grace.memberId}/deposits (tx ${deposit.transactionId} → pending CD)`);

  console.log("smoke: all checks passed");
} catch (err) {
  exitCode = 1;
  console.error(String(err));
} finally {
  server?.kill();
  await pool.end().catch(() => {});
  compose("down", "-v");
}
process.exit(exitCode);
