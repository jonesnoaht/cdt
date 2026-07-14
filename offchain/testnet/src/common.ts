/**
 * Shared plumbing for the preview-testnet run: provider construction, key
 * persistence (under the gitignored `.keys/` directory), balance helpers,
 * and retry/backoff wrappers around the public Koios endpoints.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Koios,
  Lucid,
  generatePrivateKey,
  paymentCredentialOf,
  type LucidEvolution,
  type Network,
  type PrivateKey,
} from "@lucid-evolution/lucid";
import type { Blueprint } from "@cdt/txlib";

export const NETWORK: Network = "Preview";

/** Keyless public Koios endpoint for the preview testnet. */
export const KOIOS_URL =
  process.env["KOIOS_URL"] ?? "https://preview.koios.rest/api/v1";

/** Optional Koios bearer token (not required for the public tier). */
export const KOIOS_TOKEN = process.env["KOIOS_TOKEN"];

export const EXPLORER_TX_URL = "https://preview.cardanoscan.io/transaction/";

export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Gitignored directory holding the throwaway preview-testnet keys. */
export const KEYS_DIR = join(PACKAGE_ROOT, ".keys");

/** Path to the CIP-57 blueprint produced by `aiken build`. */
export const BLUEPRINT_PATH = join(
  PACKAGE_ROOT,
  "..",
  "..",
  "onchain",
  "plutus.json",
);

export const WALLET_NAMES = ["issuer", "member", "oracle"] as const;
export type WalletName = (typeof WALLET_NAMES)[number];

export interface WalletInfo {
  name: WalletName;
  /** Bech32 ed25519 private key (ed25519_sk...). NEVER committed. */
  privateKey: PrivateKey;
  /** Bech32 preview (testnet) address. Public; safe to publish. */
  address: string;
  /** Hex payment verification key hash. */
  vkh: string;
}

export function loadBlueprint(): Blueprint {
  return JSON.parse(readFileSync(BLUEPRINT_PATH, "utf8")) as Blueprint;
}

export function makeLucid(): Promise<LucidEvolution> {
  const provider = new Koios(KOIOS_URL, KOIOS_TOKEN);
  return Lucid(provider, NETWORK);
}

function keyPath(name: WalletName): string {
  return join(KEYS_DIR, `${name}.sk`);
}

/**
 * Load the named wallet's private key from `.keys/<name>.sk`, generating and
 * persisting a fresh one if absent (idempotent across runs). The address is
 * derived through a Lucid instance so it always matches what the tx builders
 * will use.
 */
export async function loadOrCreateWallet(
  lucid: LucidEvolution,
  name: WalletName,
): Promise<WalletInfo> {
  mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  const path = keyPath(name);
  let privateKey: PrivateKey;
  if (existsSync(path)) {
    privateKey = readFileSync(path, "utf8").trim();
  } else {
    privateKey = generatePrivateKey();
    writeFileSync(path, privateKey + "\n", { mode: 0o600 });
  }
  lucid.selectWallet.fromPrivateKey(privateKey);
  const address = await lucid.wallet().address();
  const vkh = paymentCredentialOf(address).hash;
  return { name, privateKey, address, vkh };
}

/** Load all three wallets (issuer, member, oracle). */
export async function loadWallets(
  lucid: LucidEvolution,
): Promise<Record<WalletName, WalletInfo>> {
  const out = {} as Record<WalletName, WalletInfo>;
  for (const name of WALLET_NAMES) {
    out[name] = await loadOrCreateWallet(lucid, name);
  }
  return out;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry `fn` with exponential backoff — the public Koios tier rate-limits,
 * and freshly submitted UTxOs take a few blocks to be indexed.
 */
export async function withRetry<T>(
  what: string,
  fn: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = options.attempts ?? 6;
  const baseDelayMs = options.baseDelayMs ?? 3_000;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const delay = baseDelayMs * 2 ** i;
      console.warn(
        `  [retry] ${what} failed (attempt ${i + 1}/${attempts}): ${String(
          error instanceof Error ? error.message : error,
        ).slice(0, 300)}`,
      );
      if (i < attempts - 1) await sleep(delay);
    }
  }
  throw lastError;
}

/** Total lovelace currently at `address` (0n if the address has no UTxOs). */
export async function lovelaceAt(
  lucid: LucidEvolution,
  address: string,
): Promise<bigint> {
  const utxos = await lucid.utxosAt(address);
  return utxos.reduce((acc, u) => acc + (u.assets["lovelace"] ?? 0n), 0n);
}

/**
 * Linear polling until `fn` returns a value (Koios indexing lags the tip by
 * a few seconds, and reads can transiently rate-limit). Errors thrown by
 * `fn` are logged and retried; the timeout error names the real goal.
 */
export async function pollUntil<T>(
  what: string,
  fn: () => Promise<T | undefined>,
  timeoutMs = 300_000,
  intervalMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await fn();
      if (value !== undefined) return value;
    } catch (error) {
      console.log(
        `  [poll] ${what}: ${String(error instanceof Error ? error.message : error).slice(0, 200)}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await sleep(intervalMs);
  }
}

/**
 * Wait until an output of `txHash` is visible at `address` — the reliable
 * signal that Koios has indexed the tx, so subsequent balance reads at that
 * address reflect it (a fixed settle delay would race the indexer).
 */
export async function awaitOutputAt(
  lucid: LucidEvolution,
  address: string,
  txHash: string,
  what: string,
): Promise<void> {
  await pollUntil(`${what} output at ${address.slice(0, 24)}...`, async () => {
    const utxos = await lucid.utxosAt(address);
    return utxos.some((u) => u.txHash === txHash) ? true : undefined;
  });
}

/** The slice of a signed Lucid tx that submission needs. */
export interface SignedTxLike {
  toCBOR(): string;
  toHash(): string;
}

/**
 * Whether `txHash` is on-chain, via a raw Koios `/tx_info` call. Used instead
 * of `lucid.awaitTx` because the provider's response schema can lag Koios API
 * changes (observed: a schema-validation error on every poll even though the
 * tx was already in a block).
 */
export async function txOnChain(txHash: string): Promise<boolean> {
  const response = await fetch(`${KOIOS_URL}/tx_info`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(KOIOS_TOKEN ? { authorization: `Bearer ${KOIOS_TOKEN}` } : {}),
    },
    body: JSON.stringify({ _tx_hashes: [txHash] }),
  });
  if (!response.ok) {
    throw new Error(`tx_info HTTP ${response.status}`);
  }
  const result = (await response.json()) as unknown;
  return Array.isArray(result) && result.length > 0;
}

/**
 * Submit a signed tx and wait until it is on-chain, alternating submit
 * attempts with confirmation checks in ONE loop. This single shape absorbs
 * every observed failure mode of the public preview infrastructure:
 *
 * - transient submit errors / rate limits: just try again next iteration;
 * - lost ack after a successful submit (a re-submission then errors with
 *   "already in mempool" / inputs spent): the confirmation check wins;
 * - `OutsideValidityIntervalUTxO` when the tx's lower validity bound is
 *   ahead of the node's LEDGER TIP slot (the mempool validates against the
 *   tip, which trails wall-clock time by up to a preview block gap of
 *   1-2 minutes): re-submitting the identical CBOR succeeds once the next
 *   block advances the tip past the bound.
 */
export async function submitAndConfirm(
  lucid: LucidEvolution,
  signed: SignedTxLike,
  what: string,
): Promise<string> {
  const cbor = signed.toCBOR();
  const txHash = signed.toHash();
  console.log(`  ${what} tx hash: ${txHash}`);
  console.log(`  ${EXPLORER_TX_URL}${txHash}`);
  let submitted = false;
  await pollUntil(
    `${what} (${txHash}) on-chain`,
    async () => {
      if (await txOnChain(txHash)) return true;
      try {
        await lucid.config().provider!.submitTx(cbor);
        if (!submitted) {
          submitted = true;
          console.log(`  ${what} submitted.`);
        }
      } catch (error) {
        console.log(
          `  [submit] ${what}: ${String(error instanceof Error ? error.message : error).slice(0, 220)}`,
        );
      }
      return undefined;
    },
    600_000,
    10_000,
  );
  console.log(`  ${what} confirmed on-chain.`);
  return txHash;
}

export function fmtAda(lovelace: bigint): string {
  const whole = lovelace / 1_000_000n;
  const frac = (lovelace % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${frac} tADA`;
}
