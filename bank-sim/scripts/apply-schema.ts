/**
 * Apply schema.sql to the running database. Normally unnecessary (the compose
 * file mounts schema.sql into /docker-entrypoint-initdb.d), but useful after
 * dropping tables without recreating the volume.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createPool } from "../src/db.js";

const schemaPath = fileURLToPath(new URL("../schema.sql", import.meta.url));
const sql = await readFile(schemaPath, "utf8");

const pool = createPool();
try {
  await pool.query(sql);
  console.log("schema.sql applied");
} finally {
  await pool.end();
}
