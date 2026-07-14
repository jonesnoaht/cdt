/**
 * Environment configuration for the CDT pipeline.
 *
 * See README.md for the full variable table. Everything has an
 * emulator-friendly default so `npm start` against a seeded bank-sim
 * database works with no configuration at all.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type NetworkMode = "emulator" | "preview";
export type ProviderKind = "koios" | "blockfrost";

export interface PipelineEnv {
  /** Chain mode: in-process Lucid Emulator (default) or Cardano preview testnet. */
  network: NetworkMode;
  /** Preview-mode data provider. */
  provider: ProviderKind;
  koiosUrl: string;
  blockfrostUrl: string;
  blockfrostProjectId: string | undefined;
  /** CIP-57 blueprint produced by `aiken build`. */
  blueprintFile: string;
  /** Bech32 `ed25519_sk...` key files (preview mode; generated in emulator mode). */
  issuerSkFile: string | undefined;
  oracleSkFile: string | undefined;
  /** PEM PKCS#8 Ed25519 key the oracle signs attestations with. */
  oracleAttestationSkFile: string | undefined;
  /** Member key used by the redeem CLI in preview mode. */
  memberSkFile: string | undefined;
  /** Issuance-service control endpoint (used by the CLIs in emulator mode). */
  servicePort: number;
  serviceUrl: string;
  pollIntervalMs: number;
  /** Give up re-trying a failing mint after this many attempts. */
  maxMintAttempts: number;
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): PipelineEnv {
  const network = env.CDT_NETWORK ?? "emulator";
  if (network !== "emulator" && network !== "preview") {
    throw new Error(
      `CDT_NETWORK must be "emulator" or "preview", got "${network}"`,
    );
  }
  const provider = env.CDT_PROVIDER ?? "koios";
  if (provider !== "koios" && provider !== "blockfrost") {
    throw new Error(
      `CDT_PROVIDER must be "koios" or "blockfrost", got "${provider}"`,
    );
  }
  const servicePort = positiveInt(env.CDT_SERVICE_PORT, 8787);
  return {
    network,
    provider,
    koiosUrl: env.CDT_KOIOS_URL || "https://preview.koios.rest/api/v1",
    blockfrostUrl:
      env.CDT_BLOCKFROST_URL || "https://cardano-preview.blockfrost.io/api/v0",
    blockfrostProjectId: env.BLOCKFROST_PROJECT_ID || undefined,
    blueprintFile:
      env.CDT_BLUEPRINT_FILE ||
      resolve(packageRoot, "../../onchain/plutus.json"),
    issuerSkFile: env.CDT_ISSUER_SK_FILE || undefined,
    oracleSkFile: env.CDT_ORACLE_SK_FILE || undefined,
    oracleAttestationSkFile: env.CDT_ORACLE_ATTESTATION_SK_FILE || undefined,
    memberSkFile: env.CDT_MEMBER_SK_FILE || undefined,
    servicePort,
    serviceUrl: env.CDT_SERVICE_URL || `http://127.0.0.1:${servicePort}`,
    pollIntervalMs: positiveInt(env.POLL_INTERVAL_MS, 2000),
    maxMintAttempts: positiveInt(env.CDT_MAX_MINT_ATTEMPTS, 10),
  };
}
