import pg from 'pg';

export interface PgConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface OracleWatcherConfig {
  pg: PgConfig;
  pollIntervalMs: number;
}

/**
 * Parse a positive integer from an env var; falls back to `fallback` when the
 * variable is unset, empty, non-numeric, or non-positive (so a typo can never
 * yield port 0 or a NaN poll interval that busy-loops setTimeout(0)).
 */
function positiveIntFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Read configuration from the environment. Defaults match the dockerized
 * test database (`test/docker-compose.yml`): host port 55433, user/password
 * `cdt`, database `cdt_bank`.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): OracleWatcherConfig {
  return {
    pg: {
      host: env.PGHOST ?? '127.0.0.1',
      port: positiveIntFromEnv(env.PGPORT, 55433),
      user: env.PGUSER ?? 'cdt',
      password: env.PGPASSWORD ?? 'cdt',
      database: env.PGDATABASE ?? 'cdt_bank',
    },
    pollIntervalMs: positiveIntFromEnv(env.POLL_INTERVAL_MS, 5000),
  };
}

export function createPool(config: PgConfig): pg.Pool {
  return new pg.Pool({ ...config, max: 5 });
}
