import pg from "pg";

const { Pool } = pg;

export interface DbConfig {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

/**
 * Create a connection pool for the simulated core-banking database.
 *
 * Reads PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE from the
 * environment, with defaults matching docker-compose.yml
 * (localhost:55432, bank/bank, bank_sim). Explicit config overrides env.
 */
export function createPool(config: DbConfig = {}): pg.Pool {
  // `||` (not `??`) so an empty-string env var falls back to the default
  // instead of producing e.g. port 0 via Number("").
  return new Pool({
    host: config.host ?? (process.env.PGHOST || "localhost"),
    port: config.port ?? Number(process.env.PGPORT || 55432),
    user: config.user ?? (process.env.PGUSER || "bank"),
    password: config.password ?? (process.env.PGPASSWORD || "bank"),
    database: config.database ?? (process.env.PGDATABASE || "bank_sim"),
  });
}

/** Anything that can run a parameterized query (a Pool or a checked-out client). */
export type Queryable = Pick<pg.Pool, "query">;
