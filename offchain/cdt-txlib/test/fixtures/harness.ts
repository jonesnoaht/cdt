/**
 * Shared emulator harness for the builder test suites: three funded
 * accounts (member / oracle / issuer), CD terms sized so the interest
 * amounts stay above min-ADA on a two-minute term, and helpers to mint,
 * submit and inspect balances.
 *
 * Blueprint-agnostic: each suite passes its own blueprint (the always-true
 * fixtures or the real one), so the two suites cannot drift apart on the
 * harness itself.
 */
import {
  Emulator,
  Lucid,
  addAssets,
  fromText,
  generateEmulatorAccount,
  generateEmulatorAccountFromPrivateKey,
  paymentCredentialOf,
  type EmulatorAccount,
  type LucidEvolution,
  type UTxO,
} from "@lucid-evolution/lucid";
import { expect } from "vitest";
import type { Blueprint } from "../../src/blueprint.js";
import {
  buildMintTx,
  type CDTerms,
  type MintTxResult,
} from "../../src/builders.js";

// Large principal + short term so the interest amounts stay above min-ADA
// even though the emulator term is only two minutes long.
export const PRINCIPAL = 10_000_000_000_000n; // 10M ADA
export const RATE_BPS = 1_000n; // 10% p.a.
export const PENALTY_BPS = 2_000n; // 20% of accrued interest
export const TERM_MS = 120_000n; // 120 slots

export interface Ctx {
  emulator: Emulator;
  lucid: LucidEvolution;
  member: EmulatorAccount;
  oracle: EmulatorAccount;
  issuer: EmulatorAccount;
  oracleVkh: string;
  terms: CDTerms;
}

export async function setup(): Promise<Ctx> {
  const member = generateEmulatorAccount({ lovelace: 30_000_000_000_000n });
  const oracle = generateEmulatorAccountFromPrivateKey({
    lovelace: 100_000_000n,
  });
  const issuer = generateEmulatorAccount({ lovelace: 100_000_000n });
  const emulator = new Emulator([member, oracle, issuer]);
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromSeed(member.seedPhrase);
  const oracleVkh = paymentCredentialOf(oracle.address).hash;
  const issuerVkh = paymentCredentialOf(issuer.address).hash;
  const start = BigInt(emulator.now());
  const terms: CDTerms = {
    issuer: issuerVkh,
    depositId: fromText("cd-deposit-0001"),
    principal: PRINCIPAL,
    rateBps: RATE_BPS,
    start,
    maturity: start + TERM_MS,
    penaltyBps: PENALTY_BPS,
  };
  return { emulator, lucid, member, oracle, issuer, oracleVkh, terms };
}

/** Build the mint tx, sign as member + oracle, submit, await a block. */
export async function mintAndSubmit(
  blueprint: Blueprint,
  ctx: Ctx,
): Promise<MintTxResult> {
  const result = await buildMintTx(ctx.lucid, {
    blueprint,
    oracleVkh: ctx.oracleVkh,
    ownerAddress: ctx.member.address,
    terms: ctx.terms,
  });
  const memberWitness = await result.tx.partialSign.withWallet();
  const oracleWitness = await result.tx.partialSign.withPrivateKey(
    ctx.oracle.privateKey,
  );
  const signed = await result.tx
    .assemble([memberWitness, oracleWitness])
    .complete();
  await signed.submit();
  ctx.emulator.awaitBlock(1);
  return result;
}

export function requiredSigners(tx: MintTxResult["tx"]): string[] {
  const list = tx.toTransaction().body().required_signers();
  if (!list) return [];
  const out: string[] = [];
  for (let i = 0; i < list.len(); i++) out.push(list.get(i).to_hex());
  return out;
}

/** The single vault UTxO created by `mintAndSubmit`. */
export async function vaultUtxoOf(
  ctx: Ctx,
  result: MintTxResult,
): Promise<UTxO> {
  const utxos = await ctx.lucid.utxosAt(result.scripts.vaultAddress);
  expect(utxos).toHaveLength(1);
  return utxos[0]!;
}

export async function lovelaceAt(ctx: Ctx, address: string): Promise<bigint> {
  const utxos = await ctx.lucid.utxosAt(address);
  return addAssets(...utxos.map((u) => u.assets))["lovelace"] ?? 0n;
}

export async function holdsUnit(
  ctx: Ctx,
  address: string,
  unit: string,
): Promise<boolean> {
  const utxos = await ctx.lucid.utxosAt(address);
  return utxos.some((u) => (u.assets[unit] ?? 0n) > 0n);
}
