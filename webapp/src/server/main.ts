/** API server entry point: `npm run api`. */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import pg from "pg";
import { createApp } from "./app.js";
import { configFromEnv } from "./config.js";

const config = configFromEnv();
const pool = new pg.Pool(config.db);

const app = createApp({
  pool,
  chainProvider: config.chainProvider,
  koiosBaseUrl: config.koiosBaseUrl,
});

// Serve the built UI when it exists (vite build → dist/ui), so the API
// server alone can host the demo. During development, use `npm run dev`
// (vite dev server + proxy) instead.
if (existsSync("dist/ui/index.html")) {
  app.use("/*", serveStatic({ root: "./dist/ui" }));
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    `cdt-webapp api listening on http://localhost:${info.port} ` +
      `(db ${config.db.host}:${config.db.port}/${config.db.database})`,
  );
});
