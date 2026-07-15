/** API server entry point: `npm run api`. */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import pg from "pg";
import { PaymentOracle } from "./payment-oracle.js";
import { settlementRailFromEnv } from "./settlement-rail.js";
import { createApp } from "./app.js";
import { configFromEnv } from "./config.js";
const config = configFromEnv();
const pool = new pg.Pool(config.db);

if (!config.paymentOracleKeyPem && !config.allowEphemeralPaymentOracle) {
  console.error(
    "PAYMENT_ORACLE_SIGNING_KEY_PEM required (or ALLOW_EPHEMERAL_PAYMENT_ORACLE=1 for lab)",
  );
  process.exit(1);
}

const paymentOracle = new PaymentOracle(
  config.paymentOracleKeyPem
    ? { privateKeyPem: config.paymentOracleKeyPem }
    : undefined,
);
if (!config.paymentOracleKeyPem) {
  console.warn(
    "cdt-webapp: using ephemeral payment-oracle key (set PAYMENT_ORACLE_SIGNING_KEY_PEM for stable pins)",
  );
}

const app = createApp({
  pool,
  chainProvider: config.chainProvider,
  koiosBaseUrl: config.koiosBaseUrl,
  apiKey: config.allowOpenApi && !config.apiKey ? null : config.apiKey,
  allowOpenApi: config.allowOpenApi,
  paymentOracle,
  burnValidateMode: config.burnValidateMode,
  cdtPolicyId: config.cdtPolicyId,
  settlementRail: settlementRailFromEnv(),
  issuerApiKey: config.issuerApiKey,
  correspondentApiKey: config.correspondentApiKey,
  jwtSecret: config.jwtSecret,
});

// Serve the built UI when it exists (vite build → dist/ui), so the API
// server alone can host the demo. During development, use `npm run dev`
// (vite dev server + proxy) instead.
if (existsSync("dist/ui/index.html")) {
  app.use("/*", serveStatic({ root: "./dist/ui" }));
}

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(
    `cdt-webapp api listening on http://${config.host}:${info.port} ` +
      `(db ${config.db.host}:${config.db.port}/${config.db.database}; ` +
      `auth=${config.apiKey ? "api-key" : config.allowOpenApi ? "open-lab" : "fail-closed"})`,
  );
});
