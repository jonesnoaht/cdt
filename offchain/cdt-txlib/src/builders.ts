/**
 * Transaction builders for the CDT lifecycle:
 *
 * - {@link buildMintTx}: oracle-attested mint of a CDT + locking of the CD
 *   terms and principal + full interest in the vault;
 * - {@link buildRedeemTx}: redemption at/after maturity (burn CDT, pay the
 *   owner principal + full interest);
 * - {@link buildEarlyWithdrawTx}: early withdrawal with penalty (burn CDT,
 *   pay the owner the early payout, return the remainder to the issuer).
 *
 * All builders take a Lucid instance whose selected wallet funds/balances
 * the transaction, plus the CIP-57 blueprint and the oracle parameter, and
 * return an un-signed `TxSignBuilder` alongside the derived values.
 *
 * Validity bounds: the ledger expresses tx validity in slots, so POSIX-ms
 * bounds are quantized. The builders align every lower bound UP to the next
 * slot boundary (never down), guaranteeing the on-chain-visible bound is
 * `>= maturity` for redemption and exactly the time the early-withdrawal
 * amounts were computed at.
 */
import {
  Data,
  calculateMinLovelaceFromUTxO,
  paymentCredentialOf,
  slotToUnixTime,
  toUnit,
  unixTimeToSlot,
  type LucidEvolution,
  type Network,
  type TxSignBuilder,
  type Unit,
  type UTxO,
} from "@lucid-evolution/lucid";
import {
  assertHexBytes,
  resolveCdtScripts,
  type CdtScripts,
  type ResolveScriptsParams,
} from "./blueprint.js";
import {
  BPS_DENOMINATOR,
  accrued,
  fullInterest,
  maturePayout,
  penaltyFee,
} from "./interest.js";
import { CDDatum, MintRedeemer, VaultRedeemer } from "./types.js";

/** Parameters shared by all builders. */
export interface CdtScriptParams extends ResolveScriptsParams {
  /**
   * Pre-resolved scripts (from {@link resolveCdtScripts}) to reuse across
   * builder calls, skipping the per-call param application + hashing. When
   * given, it takes precedence over `blueprint`/`oracleVkh`/titles.
   */
  scripts?: CdtScripts;
}

/** The CD terms for a new certificate. */
export interface CDTerms {
  /** Hex bytes identifying the issuer (e.g. the credit union's vkh). */
  issuer: string;
  /** Hex-encoded bank deposit id; becomes the CDT asset name (<= 32 bytes). */
  depositId: string;
  /** Principal in lovelace. */
  principal: bigint;
  /** Annual simple-interest rate in basis points. */
  rateBps: bigint;
  /** CD start, POSIX time in ms. */
  start: bigint;
  /** CD maturity, POSIX time in ms. Must be > start. */
  maturity: bigint;
  /** Early-withdrawal penalty on accrued interest, in basis points. */
  penaltyBps: bigint;
}

export interface MintTxParams extends CdtScriptParams {
  /**
   * Owner (member) address. Its payment key hash becomes `CDDatum.owner`
   * and the freshly minted CDT is paid to it.
   */
  ownerAddress: string;
  terms: CDTerms;
}

export interface MintTxResult {
  tx: TxSignBuilder;
  datum: CDDatum;
  /** policyId + assetName(depositId) of the minted CDT. */
  unit: Unit;
  /** Lovelace locked at the vault: principal + full interest. */
  lockedLovelace: bigint;
  scripts: CdtScripts;
}

/** Convert a POSIX-ms bigint to number, refusing unsafe magnitudes. */
function toSafeNumber(name: string, value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`${name} (${value}) is outside the safe integer range`);
  }
  return n;
}

/**
 * Align a POSIX-ms time UP to the nearest slot boundary (the begin time of
 * the enclosing slot if already aligned, otherwise of the next slot). The
 * ledger only sees slot-aligned bounds, so this is the time an on-chain
 * validator will observe as the tx's lower bound.
 */
function ceilToSlotBegin(network: Network, timeMs: bigint): bigint {
  const ms = toSafeNumber("time", timeMs);
  const slot = unixTimeToSlot(network, ms);
  const begin = slotToUnixTime(network, slot);
  return begin >= ms ? BigInt(begin) : BigInt(slotToUnixTime(network, slot + 1));
}

/**
 * Validate CD term ranges. Applied both to caller-supplied {@link CDTerms}
 * at mint and to on-chain datums decoded in {@link readVaultDatum} — an
 * inline datum is attacker-writable data (anyone can create a UTxO at the
 * vault address), so decoded values must not be trusted to be in range.
 */
function validateTermRanges(
  where: string,
  t: {
    principal: bigint;
    rate_bps: bigint;
    start: bigint;
    maturity: bigint;
    penalty_bps: bigint;
  },
): void {
  if (t.principal <= 0n) {
    throw new Error(`${where}: principal must be positive, got ${t.principal}`);
  }
  if (t.rate_bps < 0n) {
    throw new Error(`${where}: rate_bps must be non-negative, got ${t.rate_bps}`);
  }
  if (t.start < 0n) {
    throw new Error(`${where}: start must be non-negative, got ${t.start}`);
  }
  if (t.maturity <= t.start) {
    throw new Error(
      `${where}: maturity (${t.maturity}) must be > start (${t.start})`,
    );
  }
  if (t.penalty_bps < 0n || t.penalty_bps > BPS_DENOMINATOR) {
    throw new Error(
      `${where}: penalty_bps must be in [0, ${BPS_DENOMINATOR}], got ${t.penalty_bps}`,
    );
  }
}

function resolveScripts(
  lucid: LucidEvolution,
  params: CdtScriptParams,
): CdtScripts {
  return params.scripts ?? resolveCdtScripts(lucid, params);
}

function coinsPerUtxoByte(lucid: LucidEvolution): bigint {
  const pp = lucid.config().protocolParameters;
  if (!pp) {
    throw new Error("Lucid instance has no protocol parameters configured");
  }
  return pp.coinsPerUtxoByte;
}

/**
 * Build the oracle-attested mint transaction:
 *
 * - mints exactly 1 CDT (asset name = `depositId`) with `MintCD { datum }`;
 * - pays `principal + full_interest` lovelace to the vault with the inline
 *   `CDDatum`;
 * - pays the CDT to the owner;
 * - requires the oracle as an extra signatory (the oracle watcher attests
 *   the bank deposit by co-signing).
 *
 * The selected wallet funds the transaction (principal + interest + fees).
 */
export async function buildMintTx(
  lucid: LucidEvolution,
  params: MintTxParams,
): Promise<MintTxResult> {
  const { terms } = params;
  const issuer = assertHexBytes("terms.issuer", terms.issuer);
  if (issuer.length === 0) {
    throw new Error("terms.issuer must not be empty");
  }
  const depositId = assertHexBytes("terms.depositId", terms.depositId);
  if (depositId.length === 0 || depositId.length > 64) {
    throw new Error(
      `terms.depositId must be 1..32 bytes, got ${depositId.length / 2}`,
    );
  }
  validateTermRanges("terms", {
    principal: terms.principal,
    rate_bps: terms.rateBps,
    start: terms.start,
    maturity: terms.maturity,
    penalty_bps: terms.penaltyBps,
  });

  const scripts = resolveScripts(lucid, params);

  const ownerCredential = paymentCredentialOf(params.ownerAddress);
  if (ownerCredential.type !== "Key") {
    throw new Error("ownerAddress must have a key payment credential");
  }

  const datum: CDDatum = {
    owner: ownerCredential.hash,
    issuer,
    deposit_id: depositId,
    principal: terms.principal,
    rate_bps: terms.rateBps,
    start: terms.start,
    maturity: terms.maturity,
    penalty_bps: terms.penaltyBps,
    cdt_policy: scripts.policyId,
  };
  const datumCbor = Data.to(datum, CDDatum);

  const unit = toUnit(scripts.policyId, depositId);
  const lockedLovelace =
    terms.principal +
    fullInterest(terms.principal, terms.rateBps, terms.start, terms.maturity);

  // Lucid silently raises a below-minimum output to min-ADA (funded from the
  // wallet), which would make the vault hold more than principal + interest
  // and desync it from the datum. Refuse instead.
  const minVaultLovelace = calculateMinLovelaceFromUTxO(
    coinsPerUtxoByte(lucid),
    {
      txHash: "00".repeat(32),
      outputIndex: 0,
      address: scripts.vaultAddress,
      assets: { lovelace: lockedLovelace },
      datum: datumCbor,
    },
  );
  if (lockedLovelace < minVaultLovelace) {
    throw new Error(
      `principal + full interest (${lockedLovelace} lovelace) is below the vault output's min-ADA (${minVaultLovelace} lovelace); increase the principal`,
    );
  }

  const tx = await lucid
    .newTx()
    .mintAssets({ [unit]: 1n }, Data.to({ MintCD: { datum } }, MintRedeemer))
    .attach.MintingPolicy(scripts.mintPolicy)
    .pay.ToContract(
      scripts.vaultAddress,
      { kind: "inline", value: datumCbor },
      { lovelace: lockedLovelace },
    )
    .pay.ToAddress(params.ownerAddress, { [unit]: 1n })
    .addSignerKey(scripts.oracleVkh)
    .complete();

  return { tx, datum, unit, lockedLovelace, scripts };
}

export interface RedeemTxParams extends CdtScriptParams {
  /** The vault UTxO holding the CD (must carry the inline `CDDatum`). */
  vaultUtxo: UTxO;
  /**
   * Address paid the principal + full interest. Its payment credential must
   * be the datum's `owner`.
   */
  ownerAddress: string;
  /**
   * Requested lower validity bound (POSIX ms). Defaults to the datum's
   * `maturity`; must be >= it. The bound actually set on the tx is this
   * value aligned up to the next slot boundary (see module docs). The
   * wallet must hold the CDT so it can be burned.
   */
  validFrom?: bigint;
}

export interface RedeemTxResult {
  tx: TxSignBuilder;
  datum: CDDatum;
  unit: Unit;
  /** principal + full interest paid to the owner. */
  payout: bigint;
  /** The slot-aligned lower validity bound set on the tx (POSIX ms). */
  validFrom: bigint;
  scripts: CdtScripts;
}

/**
 * Decode and validate the inline `CDDatum` of a vault UTxO: the datum's
 * `cdt_policy` must match the policy derived from the blueprint, and all
 * term fields must be in range (an inline datum at a public address is
 * attacker-writable data, so decoded values are not trusted).
 */
export function readVaultDatum(vaultUtxo: UTxO, scripts: CdtScripts): CDDatum {
  if (!vaultUtxo.datum) {
    throw new Error("vaultUtxo has no inline datum");
  }
  const datum = Data.from(vaultUtxo.datum, CDDatum);
  if (datum.cdt_policy !== scripts.policyId) {
    throw new Error(
      `Datum cdt_policy (${datum.cdt_policy}) does not match the policy id derived from the blueprint (${scripts.policyId}); wrong blueprint or oracle parameter?`,
    );
  }
  validateTermRanges("vault datum", datum);
  return datum;
}

function assertOwnerAddress(ownerAddress: string, datum: CDDatum): void {
  const cred = paymentCredentialOf(ownerAddress);
  if (cred.type !== "Key" || cred.hash !== datum.owner) {
    throw new Error(
      `ownerAddress payment credential (${cred.hash}) does not match the datum's owner (${datum.owner})`,
    );
  }
}

/**
 * Build the at/after-maturity redemption transaction:
 *
 * - spends the vault UTxO with the `Redeem` redeemer;
 * - sets the validity lower bound to `maturity` (or later), aligned up to a
 *   slot boundary so the on-chain bound is never before `maturity`;
 * - burns the CDT with `BurnCD`;
 * - pays the owner `principal + full_interest`;
 * - requires the owner's signature.
 */
export async function buildRedeemTx(
  lucid: LucidEvolution,
  params: RedeemTxParams,
): Promise<RedeemTxResult> {
  const scripts = resolveScripts(lucid, params);
  const datum = readVaultDatum(params.vaultUtxo, scripts);
  assertOwnerAddress(params.ownerAddress, datum);

  const requested = params.validFrom ?? datum.maturity;
  if (requested < datum.maturity) {
    throw new Error(
      `validFrom (${requested}) must be >= maturity (${datum.maturity})`,
    );
  }
  const lowerBound = ceilToSlotBegin(scripts.network, requested);

  const unit = toUnit(datum.cdt_policy, datum.deposit_id);
  const payout = maturePayout(
    datum.principal,
    datum.rate_bps,
    datum.start,
    datum.maturity,
  );

  const tx = await lucid
    .newTx()
    .collectFrom([params.vaultUtxo], Data.to("Redeem", VaultRedeemer))
    .attach.SpendingValidator(scripts.vaultValidator)
    .mintAssets({ [unit]: -1n }, Data.to("BurnCD", MintRedeemer))
    .attach.MintingPolicy(scripts.mintPolicy)
    .validFrom(toSafeNumber("validFrom", lowerBound))
    .pay.ToAddress(params.ownerAddress, { lovelace: payout })
    .addSignerKey(datum.owner)
    .complete();

  return { tx, datum, unit, payout, validFrom: lowerBound, scripts };
}

export interface EarlyWithdrawTxParams extends CdtScriptParams {
  /** The vault UTxO holding the CD (must carry the inline `CDDatum`). */
  vaultUtxo: UTxO;
  /**
   * Address paid the early payout. Its payment credential must be the
   * datum's `owner`.
   */
  ownerAddress: string;
  /** Address paid the remainder (the issuer / credit union). */
  issuerAddress: string;
  /**
   * Requested withdrawal time `t` (POSIX ms). The effective time — used
   * both as the tx's lower validity bound and for the payout math, so the
   * two always agree on-chain — is `t` aligned up to the next slot
   * boundary; it must satisfy `start <= t' < maturity`.
   */
  withdrawAt: bigint;
}

export interface EarlyWithdrawTxResult {
  tx: TxSignBuilder;
  datum: CDDatum;
  unit: Unit;
  /** Interest accrued at the effective (slot-aligned) withdrawal time. */
  accrued: bigint;
  /** Penalty withheld from the accrued interest. */
  penalty: bigint;
  /** principal + accrued - penalty, paid to the owner. */
  payout: bigint;
  /** Vault lovelace returned to the issuer. */
  remainder: bigint;
  /**
   * The effective withdrawal time: the slot-aligned lower validity bound
   * set on the tx (POSIX ms). All amounts are computed at this time.
   */
  validFrom: bigint;
  scripts: CdtScripts;
}

/**
 * Build the early-withdrawal transaction:
 *
 * - spends the vault UTxO with the `EarlyWithdraw` redeemer;
 * - sets the validity lower bound to `t` aligned up to a slot boundary, and
 *   computes all amounts at that same aligned time, so an on-chain validator
 *   deriving the accrual from the tx's lower bound sees exactly the amounts
 *   paid;
 * - burns the CDT with `BurnCD`;
 * - pays the owner `principal + accrued(t) - penalty_fee(t)`;
 * - pays the remaining vault lovelace back to the issuer;
 * - requires the owner's signature.
 *
 * If the remainder is positive but below the issuer output's min-ADA the
 * builder throws (Lucid would otherwise silently raise the output above the
 * true remainder); realistic CD sizes keep the remainder well above it.
 */
export async function buildEarlyWithdrawTx(
  lucid: LucidEvolution,
  params: EarlyWithdrawTxParams,
): Promise<EarlyWithdrawTxResult> {
  const scripts = resolveScripts(lucid, params);
  const datum = readVaultDatum(params.vaultUtxo, scripts);
  assertOwnerAddress(params.ownerAddress, datum);

  if (params.withdrawAt < datum.start || params.withdrawAt >= datum.maturity) {
    throw new Error(
      `withdrawAt (${params.withdrawAt}) must be in [start, maturity) = [${datum.start}, ${datum.maturity}); use buildRedeemTx at/after maturity`,
    );
  }
  // The on-chain-visible lower bound is slot-aligned; compute the payout at
  // exactly that time so off-chain and on-chain math agree.
  const t = ceilToSlotBegin(scripts.network, params.withdrawAt);
  if (t >= datum.maturity) {
    throw new Error(
      `withdrawAt (${params.withdrawAt}) aligns to slot boundary ${t}, which is not before maturity (${datum.maturity}); use buildRedeemTx instead`,
    );
  }

  const unit = toUnit(datum.cdt_policy, datum.deposit_id);
  const accruedInterest = accrued(
    datum.principal,
    datum.rate_bps,
    datum.start,
    datum.maturity,
    t,
  );
  const penalty = penaltyFee(
    datum.principal,
    datum.rate_bps,
    datum.start,
    datum.maturity,
    datum.penalty_bps,
    t,
  );
  const payout = datum.principal + accruedInterest - penalty;
  const vaultLovelace = params.vaultUtxo.assets["lovelace"] ?? 0n;
  const remainder = vaultLovelace - payout;
  if (remainder < 0n) {
    throw new Error(
      `Vault holds ${vaultLovelace} lovelace but early payout is ${payout}`,
    );
  }

  let txb = lucid
    .newTx()
    .collectFrom([params.vaultUtxo], Data.to("EarlyWithdraw", VaultRedeemer))
    .attach.SpendingValidator(scripts.vaultValidator)
    .mintAssets({ [unit]: -1n }, Data.to("BurnCD", MintRedeemer))
    .attach.MintingPolicy(scripts.mintPolicy)
    .validFrom(toSafeNumber("withdrawAt", t))
    .pay.ToAddress(params.ownerAddress, { lovelace: payout })
    .addSignerKey(datum.owner);

  if (remainder > 0n) {
    const minIssuerLovelace = calculateMinLovelaceFromUTxO(
      coinsPerUtxoByte(lucid),
      {
        txHash: "00".repeat(32),
        outputIndex: 0,
        address: params.issuerAddress,
        assets: { lovelace: remainder },
      },
    );
    if (remainder < minIssuerLovelace) {
      throw new Error(
        `Issuer remainder (${remainder} lovelace) is below the output's min-ADA (${minIssuerLovelace} lovelace); the transaction cannot pay it out exactly`,
      );
    }
    txb = txb.pay.ToAddress(params.issuerAddress, { lovelace: remainder });
  }

  const tx = await txb.complete();

  return {
    tx,
    datum,
    unit,
    accrued: accruedInterest,
    penalty,
    payout,
    remainder,
    validFrom: t,
    scripts,
  };
}
