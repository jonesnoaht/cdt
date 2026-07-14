export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface ServerConfig {
  db: DbConfig;
  /** Port the API server listens on. */
  port: number;
  /** Optional on-chain lookup provider ("koios-preview") — off by default. */
  chainProvider: string | undefined;
  /** Koios REST base URL (only used when chainProvider is koios-preview). */
  koiosBaseUrl: string;
}

/**
 * Read configuration from the environment. Defaults target the running
 * bank-sim database (localhost:55432, bank/bank, bank_sim) and API port 8787.
 * `||` (not `??`) so empty-string env vars fall back to defaults.
 */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    db: {
      host: env.PGHOST || "localhost",
      port: Number(env.PGPORT || 55432),
      user: env.PGUSER || "bank",
      password: env.PGPASSWORD || "bank",
      database: env.PGDATABASE || "bank_sim",
    },
    port: Number(env.PORT || 8787),
    chainProvider: env.CHAIN_PROVIDER || undefined,
    koiosBaseUrl: env.KOIOS_BASE_URL || "https://preview.koios.rest/api/v1",
  };
}
