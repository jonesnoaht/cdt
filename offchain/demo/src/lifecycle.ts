/**
 * On-chain lifecycle helpers for the CDT demo: emulator setup, CDT mint
 * (oracle-attested), redemption at maturity, and early withdrawal.
 *
 * Shared between the narrated demo (src/demo.ts) and the vitest e2e suite.
 */

import {
  Data,
  Emulator,
  fromText,
  generateEmulatorAccountFromPrivateKey,
  Lucid,
  paymentCredentialOf,
  type EmulatorAccount,
  type LucidEvolution,
  type UTxO,
} from "@lucid-evolution/lucid";

import {
  CDDatum,
  instantiateContracts,
  MintRedeemer,
  VaultRedeemer,
  type CdtContracts,
} from "./contracts.js";
import { earlyPayout, fullInterest, maturePayout, type CdTerms } from "./interest.js";

const NETWORK = "Custom" as const;

/** Minimum lovelace we attach to bare payment outputs (covers min-ADA). */
export const MIN_PAYOUT_LOVELACE = 2_000_000n;

export interface Party {
  name: string;
  account: EmulatorAccount;
  /** Payment verification key hash (hex). */
  vkh: string;
}

export interface ChainContext {
  emulator: Emulator;
  lucid: LucidEvolution;
  creditUnion: Party;
  member: Party;
  oracle: Party;
  contracts: CdtContracts;
}

function makeParty(name: string, lovelace: bigint): Party {
  const account = generateEmulatorAccountFromPrivateKey({ lovelace });
  return {
    name,
    account,
    vkh: paymentCredentialOf(account.address).hash,
  };
}

/**
 * Boot a fresh in-process emulator with three funded wallets and the two
 * vendored validators instantiated against the oracle's key.
 */
export async function setupChain(): Promise<ChainContext> {
  const creditUnion = makeParty("CampusUSA Credit Union", 50_000_000_000n);
  const member = makeParty("Member", 5_000_000_000n);
  const oracle = makeParty("Deposit oracle", 1_000_000_000n);

  const emulator = new Emulator([
    creditUnion.account,
    member.account,
    oracle.account,
  ]);
  const lucid = await Lucid(emulator, NETWORK);
  const contracts = instantiateContracts(NETWORK, oracle.vkh);

  return { emulator, lucid, creditUnion, member, oracle, contracts };
}

/** Encode a human-readable deposit id as a CDT asset name (hex). */
export function depositIdToAssetName(depositId: string): string {
  const hex = fromText(depositId);
  if (hex.length > 64) {
    throw new Error(`deposit id exceeds the 32-byte asset-name limit: ${depositId}`);
  }
  return hex;
}

/** The full CDT unit string for a deposit id. */
export function cdtUnit(ctx: ChainContext, depositIdHex: string): string {
  return ctx.contracts.policyId + depositIdHex;
}

export interface CdOnChain {
  datum: CDDatum;
  terms: CdTerms;
  unit: string;
  /** Lovelace locked at the vault: principal + full interest. */
  locked: bigint;
  mintTxHash: string;
}

/**
 * Mint a CDT: the credit union locks principal + full interest at the vault,
 * the oracle co-signs to attest that the fiat deposit landed.
 *
 * Pass `{ attested: false }` to build the same transaction WITHOUT the
 * oracle's required signature — used by the negative tests to prove the
 * policy refuses unattested mints on the real minting code path.
 */
export async function mintCd(
  ctx: ChainContext,
  depositIdHex: string,
  params: { principal: bigint; rateBps: bigint; termMs: bigint; penaltyBps: bigint },
  options: { attested?: boolean } = {},
): Promise<CdOnChain> {
  const { lucid, emulator, creditUnion, member, oracle, contracts } = ctx;
  const attested = options.attested ?? true;

  const start = BigInt(emulator.now());
  const terms: CdTerms = {
    principal: params.principal,
    rateBps: params.rateBps,
    start,
    maturity: start + params.termMs,
    penaltyBps: params.penaltyBps,
  };
  const datum: CDDatum = {
    owner: member.vkh,
    issuer: creditUnion.vkh,
    deposit_id: depositIdHex,
    principal: terms.principal,
    rate_bps: terms.rateBps,
    start: terms.start,
    maturity: terms.maturity,
    penalty_bps: terms.penaltyBps,
    cdt_policy: contracts.policyId,
  };
  const unit = cdtUnit(ctx, depositIdHex);
  const locked = terms.principal + fullInterest(terms);

  lucid.selectWallet.fromPrivateKey(creditUnion.account.privateKey);
  let txBuilder = lucid
    .newTx()
    .mintAssets(
      { [unit]: 1n },
      Data.to({ MintCD: { datum } }, MintRedeemer),
    )
    .attach.MintingPolicy(contracts.mintScript)
    .pay.ToContract(
      contracts.vaultAddress,
      { kind: "inline", value: Data.to(datum, CDDatum) },
      { lovelace: locked, [unit]: 1n },
    );
  if (attested) {
    txBuilder = txBuilder.addSigner(oracle.account.address);
  }
  const tx = await txBuilder.complete();

  const signed = await tx.sign
    .withWallet() // credit union (fee payer / funds)
    .sign.withPrivateKey(oracle.account.privateKey) // oracle attestation
    .complete();
  const mintTxHash = await signed.submit();
  await emulator.awaitTx(mintTxHash);

  return { datum, terms, unit, locked, mintTxHash };
}

/** Fetch the (single) vault UTxO currently holding the given CDT. */
export async function findVaultUtxo(
  ctx: ChainContext,
  unit: string,
): Promise<UTxO> {
  const utxos = await ctx.lucid.utxosAtWithUnit(ctx.contracts.vaultAddress, unit);
  const utxo = utxos[0];
  if (!utxo || utxos.length !== 1) {
    throw new Error(`expected exactly one vault UTxO for ${unit}, got ${utxos.length}`);
  }
  return utxo;
}

export interface RedeemResult {
  txHash: string;
  fee: bigint;
  /** Time attested by the tx validity lower bound (POSIX ms). */
  at: bigint;
  payout: bigint;
}

/**
 * Shared vault-spend scaffolding: the member collects the vault UTxO with the
 * given redeemer, burns the CDT, takes `payout` in a dedicated output, plus
 * any extra payments (e.g. the issuer's remainder on early withdrawal).
 */
async function spendVault(
  ctx: ChainContext,
  cd: CdOnChain,
  redeemer: VaultRedeemer,
  now: bigint,
  payout: bigint,
  vaultUtxo: UTxO,
  extraPayments: { address: string; lovelace: bigint }[] = [],
): Promise<RedeemResult> {
  const { lucid, emulator, member, contracts } = ctx;

  lucid.selectWallet.fromPrivateKey(member.account.privateKey);
  let txBuilder = lucid
    .newTx()
    .collectFrom([vaultUtxo], Data.to(redeemer, VaultRedeemer))
    .attach.SpendingValidator(contracts.vaultScript)
    .mintAssets({ [cd.unit]: -1n }, Data.to("BurnCD", MintRedeemer))
    .attach.MintingPolicy(contracts.mintScript)
    .pay.ToAddress(member.account.address, { lovelace: payout });
  for (const payment of extraPayments) {
    txBuilder = txBuilder.pay.ToAddress(payment.address, {
      lovelace: payment.lovelace,
    });
  }
  const tx = await txBuilder
    .addSigner(member.account.address)
    .validFrom(Number(now))
    .complete();

  const signed = await tx.sign.withWallet().complete();
  const fee = signed.toTransaction().body().fee();
  const txHash = await signed.submit();
  await emulator.awaitTx(txHash);

  return { txHash, fee, at: now, payout };
}

/**
 * Redeem at (or after) maturity: the member burns the CDT and receives
 * principal + full interest in a dedicated output.
 */
export async function redeemCd(ctx: ChainContext, cd: CdOnChain): Promise<RedeemResult> {
  const now = BigInt(ctx.emulator.now());
  const payout = maturePayout(cd.terms);
  const vaultUtxo = await findVaultUtxo(ctx, cd.unit);
  return spendVault(ctx, cd, "Redeem", now, payout, vaultUtxo);
}

export interface EarlyWithdrawResult extends RedeemResult {
  /** Lovelace returned to the issuer's output. */
  issuerReturn: bigint;
  /** Portion of `issuerReturn` mandated by the validator. */
  remainder: bigint;
}

/**
 * Withdraw before maturity: the member burns the CDT, takes
 * principal + accrued - penalty, and the remainder of the locked lovelace is
 * paid back to the issuer (topped up to min-ADA if needed).
 */
export async function earlyWithdrawCd(
  ctx: ChainContext,
  cd: CdOnChain,
): Promise<EarlyWithdrawResult> {
  const now = BigInt(ctx.emulator.now());
  if (now < cd.terms.start || now >= cd.terms.maturity) {
    throw new Error("early withdrawal must happen within the term");
  }
  const payout = earlyPayout(cd.terms, now);
  const vaultUtxo = await findVaultUtxo(ctx, cd.unit);
  const remainder = (vaultUtxo.assets.lovelace ?? 0n) - payout;
  const issuerReturn = remainder > MIN_PAYOUT_LOVELACE ? remainder : MIN_PAYOUT_LOVELACE;

  const result = await spendVault(ctx, cd, "EarlyWithdraw", now, payout, vaultUtxo, [
    { address: ctx.creditUnion.account.address, lovelace: issuerReturn },
  ]);
  return { ...result, issuerReturn, remainder };
}

/** Sum the lovelace held by an address. */
export async function lovelaceAt(ctx: ChainContext, address: string): Promise<bigint> {
  const utxos = await ctx.lucid.utxosAt(address);
  return utxos.reduce((acc, utxo) => acc + (utxo.assets.lovelace ?? 0n), 0n);
}

/** Total amount of `unit` in the whole emulated ledger (0n once burned). */
export function circulatingSupply(ctx: ChainContext, unit: string): bigint {
  return Object.values(ctx.emulator.ledger).reduce(
    (acc, { utxo }) => acc + (utxo.assets[unit] ?? 0n),
    0n,
  );
}

/** Advance emulator time until strictly past `posixMs`. */
export function advancePast(ctx: ChainContext, posixMs: bigint): void {
  while (BigInt(ctx.emulator.now()) < posixMs) {
    ctx.emulator.awaitBlock(1); // 20 slots / 20 seconds per block
  }
}
