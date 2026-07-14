/**
 * Chain-context factory: builds a Lucid instance plus the pipeline's key
 * material from the environment.
 *
 * - `CDT_NETWORK=emulator` (default): an in-process Lucid Emulator. Wallets
 *   are freshly generated and self-funded by the emulator's genesis ledger;
 *   no key files are needed (the chain only lives as long as the process).
 * - `CDT_NETWORK=preview`: the Cardano preview testnet, through Koios
 *   (`CDT_PROVIDER=koios`, default) or Blockfrost (`CDT_PROVIDER=blockfrost`
 *   with `BLOCKFROST_PROJECT_ID`). Issuer/oracle keys are loaded from the
 *   env-pointed key files (never committed; see `npm run keygen`).
 */
import type { KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  Blockfrost,
  Emulator,
  Koios,
  Lucid,
  generateEmulatorAccountFromPrivateKey,
  makeWalletFromPrivateKey,
  paymentCredentialOf,
  type LucidEvolution,
  type Network,
  type Provider,
} from "./lucid.js";
import {
  resolveCdtScripts,
  type Blueprint,
  type CdtScripts,
} from "../../cdt-txlib/src/index.ts";
import {
  generateEd25519KeyPair,
  privateKeyFromPem,
} from "../../oracle-watcher/src/index.ts";
import type { PipelineEnv } from "./env.js";

/** A wallet the pipeline can select and sign with. */
export interface WalletKey {
  /** Bech32 `ed25519_sk...` private key. */
  privateKey: string;
  address: string;
  /** Hex payment verification key hash. */
  vkh: string;
}

export interface ChainContext {
  mode: "emulator" | "preview";
  network: Network;
  lucid: LucidEvolution;
  /** Present in emulator mode only. */
  emulator: Emulator | undefined;
  /** Funds mints (principal + interest) and receives early-withdraw remainders. */
  issuer: WalletKey;
  /** Co-signs mints; its vkh parameterizes the CDT minting policy. */
  oracle: WalletKey;
  /** Ed25519 key the oracle watcher signs bank attestations with. */
  oracleAttestationKey: KeyObject;
  /** Pre-funded member wallets (emulator mode only). */
  memberWallets: WalletKey[];
  blueprint: Blueprint;
  scripts: CdtScripts;
  /** Wall-clock for CD terms: emulator time in emulator mode. */
  now(): number;
  /** Select `key` as the active signing wallet on `lucid`. */
  selectWallet(key: string): void;
  /** Wait until `txHash` is confirmed (one emulator block / provider poll). */
  awaitTx(txHash: string): Promise<void>;
}

export interface ChainContextOptions {
  /** Number of pre-funded member wallets to create in emulator mode. */
  memberWallets?: number;
  /** Genesis lovelace for the issuer wallet in emulator mode. */
  issuerFunds?: bigint;
  /** Genesis lovelace per member wallet in emulator mode. */
  memberFunds?: bigint;
}

export function loadBlueprint(file: string): Blueprint {
  return JSON.parse(readFileSync(file, "utf8")) as Blueprint;
}

function readKeyFile(name: string, file: string | undefined): string {
  if (!file) {
    throw new Error(
      `${name} is required in preview mode; generate keys with \`npm run keygen\` and point the env var at the file`,
    );
  }
  return readFileSync(file, "utf8").trim();
}

async function walletKeyFromSk(
  provider: Provider,
  network: Network,
  privateKey: string,
): Promise<WalletKey> {
  const wallet = makeWalletFromPrivateKey(provider, network, privateKey);
  const address = await wallet.address();
  return { privateKey, address, vkh: paymentCredentialOf(address).hash };
}

export async function createChainContext(
  env: PipelineEnv,
  options: ChainContextOptions = {},
): Promise<ChainContext> {
  const blueprint = loadBlueprint(env.blueprintFile);

  if (env.network === "emulator") {
    const issuerAccount = generateEmulatorAccountFromPrivateKey({
      lovelace: options.issuerFunds ?? 1_000_000_000_000_000n, // 1B ADA
    });
    const oracleAccount = generateEmulatorAccountFromPrivateKey({
      lovelace: 1_000_000_000n,
    });
    const memberAccounts = Array.from(
      { length: options.memberWallets ?? 8 },
      () =>
        generateEmulatorAccountFromPrivateKey({
          lovelace: options.memberFunds ?? 5_000_000_000n, // 5k ADA
        }),
    );
    const emulator = new Emulator([
      issuerAccount,
      oracleAccount,
      ...memberAccounts,
    ]);
    // Also installs the emulator's Custom slot config into the (shared, see
    // src/lucid.ts) SLOT_CONFIG_NETWORK module state.
    const lucid = await Lucid(emulator, "Custom");

    const toWalletKey = (account: {
      privateKey: string;
      address: string;
    }): WalletKey => ({
      privateKey: account.privateKey,
      address: account.address,
      vkh: paymentCredentialOf(account.address).hash,
    });
    const oracle = toWalletKey(oracleAccount);
    const scripts = resolveCdtScripts(lucid, {
      blueprint,
      oracleVkh: oracle.vkh,
    });
    return {
      mode: "emulator",
      network: "Custom",
      lucid,
      emulator,
      issuer: toWalletKey(issuerAccount),
      oracle,
      oracleAttestationKey: generateEd25519KeyPair().privateKey,
      memberWallets: memberAccounts.map(toWalletKey),
      blueprint,
      scripts,
      now: () => emulator.now(),
      selectWallet: (key) => lucid.selectWallet.fromPrivateKey(key),
      awaitTx: async (txHash) => {
        await lucid.awaitTx(txHash, 20);
      },
    };
  }

  // --- preview testnet -------------------------------------------------
  let provider: Provider;
  if (env.provider === "blockfrost") {
    if (!env.blockfrostProjectId) {
      throw new Error(
        "BLOCKFROST_PROJECT_ID is required with CDT_PROVIDER=blockfrost",
      );
    }
    provider = new Blockfrost(env.blockfrostUrl, env.blockfrostProjectId);
  } else {
    provider = new Koios(env.koiosUrl);
  }
  const network: Network = "Preview";
  const lucid = await Lucid(provider, network);

  const issuer = await walletKeyFromSk(
    provider,
    network,
    readKeyFile("CDT_ISSUER_SK_FILE", env.issuerSkFile),
  );
  const oracle = await walletKeyFromSk(
    provider,
    network,
    readKeyFile("CDT_ORACLE_SK_FILE", env.oracleSkFile),
  );
  const oracleAttestationKey = privateKeyFromPem(
    readKeyFile(
      "CDT_ORACLE_ATTESTATION_SK_FILE",
      env.oracleAttestationSkFile,
    ),
  );
  const scripts = resolveCdtScripts(lucid, { blueprint, oracleVkh: oracle.vkh });
  return {
    mode: "preview",
    network,
    lucid,
    emulator: undefined,
    issuer,
    oracle,
    oracleAttestationKey,
    memberWallets: [],
    blueprint,
    scripts,
    now: () => Date.now(),
    selectWallet: (key) => lucid.selectWallet.fromPrivateKey(key),
    awaitTx: async (txHash) => {
      await lucid.awaitTx(txHash, 5000);
    },
  };
}
