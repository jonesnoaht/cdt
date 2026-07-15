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
  /** Bind host. Default 127.0.0.1 — never expose without auth. */
  host: string;
  /**
   * API key required for non-public routes. When unset, the server refuses
   * protected routes (fail-closed) unless CDT_ALLOW_OPEN_API=1 (lab only).
   */
  apiKey: string | undefined;
  /** Lab escape hatch: allow open API when no CDT_API_KEY (tests/demo). */
  allowOpenApi: boolean;
  /** Optional on-chain lookup provider ("koios-preview") — off by default. */
  chainProvider: string | undefined;
  /** Koios REST base URL (only used when chainProvider is koios-preview). */
  koiosBaseUrl: string;
  /** PEM for payment-check oracle; if unset, ephemeral lab key. */
  paymentOracleKeyPem: string | undefined;
  /** Allow ephemeral payment oracle key (lab). */
  allowEphemeralPaymentOracle: boolean;
  /** Pinned mint-oracle SPKI (base64) for attestation verification endpoints. */
  mintOraclePubkeySpki: string | undefined;
  /** Burn validation: off | soft | strict. */
  burnValidateMode: "off" | "soft" | "strict";
  /** Optional CDT policy id for burn asset matching. */
  cdtPolicyId: string | undefined;
  /** Issuer institutional API key (optional dual-key mode). */
  issuerApiKey: string | undefined;
  /** Correspondent institutional API key (optional dual-key mode). */
  correspondentApiKey: string | undefined;
  /** HS256 JWT secret for institutional tokens. */
  jwtSecret: string | undefined;
}

/**
 * Read configuration from the environment.
 *
 * Defaults target the running bank-sim database (localhost:55432). DB password
 * has no insecure default when NODE_ENV=production.
 */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const isProd = env.NODE_ENV === "production";
  const dbPassword = env.PGPASSWORD || (isProd ? "" : "bank");
  if (isProd && !env.PGPASSWORD) {
    throw new Error("PGPASSWORD is required when NODE_ENV=production");
  }
  return {
    db: {
      host: env.PGHOST || "localhost",
      port: Number(env.PGPORT || 55432),
      user: env.PGUSER || "bank",
      password: dbPassword,
      database: env.PGDATABASE || "bank_sim",
    },
    port: Number(env.PORT || 8787),
    host: env.HOST || "127.0.0.1",
    apiKey: env.CDT_API_KEY || undefined,
    allowOpenApi: env.CDT_ALLOW_OPEN_API === "1" || (!isProd && !env.CDT_API_KEY),
    chainProvider: env.CHAIN_PROVIDER || undefined,
    koiosBaseUrl: env.KOIOS_BASE_URL || "https://preview.koios.rest/api/v1",
    paymentOracleKeyPem: env.PAYMENT_ORACLE_SIGNING_KEY_PEM || undefined,
    allowEphemeralPaymentOracle:
      env.ALLOW_EPHEMERAL_PAYMENT_ORACLE === "1" || !isProd,
    mintOraclePubkeySpki: env.MINT_ORACLE_PUBKEY_SPKI || undefined,
    burnValidateMode: (() => {
      const raw = (env.BURN_VALIDATE_MODE || "").toLowerCase();
      if (raw === "off" || raw === "soft" || raw === "strict") return raw;
      return env.CHAIN_PROVIDER === "koios-preview" ? "strict" : "off";
    })(),
    cdtPolicyId: env.CDT_POLICY_ID || undefined,
    issuerApiKey: env.CDT_ISSUER_API_KEY || undefined,
    correspondentApiKey: env.CDT_CORRESPONDENT_API_KEY || undefined,
    jwtSecret: env.CDT_JWT_SECRET || undefined,
  };
}
