/**
 * Transaction builders for the CDT lifecycle:
 *
 * - {@link buildMintTx}: oracle-attested mint of a CDT, locked in the vault
 *   together with the CD terms and principal + full interest;
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
  /**
   * Bank-core account id that funded the CD (UTF-8, hex-encoded via fromText
   * or raw hex of UTF-8 bytes). Bound into the vault datum and must match the
   * oracle attestation's account_id.
   */
  accountId: string;
  /**
   * 32-byte SHA-256 of the canonical oracle attestation payload, as hex
   * (64 hex chars). On-chain mint requires length == 32 bytes.
   */
  attestationHash: string;
}

export interface MintTxParams extends CdtScriptParams {
  /**
   * Owner (member) address. Its payment key hash becomes `CDDatum.owner`,
   * which is what tracks ownership of the CD — the freshly minted CDT itself
   * is locked inside the vault output, as the on-chain policy requires.
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
 * - locks the minted CDT at the vault, together with
 *   `principal + full_interest` lovelace and the inline `CDDatum` — the
 *   on-chain policy requires the token INSIDE the vault output (a mint
 *   paying the CDT anywhere else fails phase-2 validation); ownership is
 *   tracked by `CDDatum.owner`, not by token custody;
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
  const accountId = assertHexBytes("terms.accountId", terms.accountId);
  if (accountId.length === 0 || accountId.length > 64) {
    throw new Error(
      `terms.accountId must be 1..32 bytes, got ${accountId.length / 2}`,
    );
  }
  const attestationHash = assertHexBytes(
    "terms.attestationHash",
    terms.attestationHash,
  );
  if (attestationHash.length !== 64) {
    throw new Error(
      `terms.attestationHash must be exactly 32 bytes (64 hex chars), got ${attestationHash.length / 2}`,
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
    account_id: accountId,
    attestation_hash: attestationHash,
  };
  const datumCbor = Data.to(datum, CDDatum);

  const unit = toUnit(scripts.policyId, depositId);
  const lockedLovelace =
    terms.principal +
    fullInterest(terms.principal, terms.rateBps, terms.start, terms.maturity);
  // The exact value the vault output must hold — and the one the min-ADA
  // precheck below must be computed against, or the check under-estimates.
  const vaultAssets = { lovelace: lockedLovelace, [unit]: 1n };

  // Lucid silently raises a below-minimum output to min-ADA (funded from the
  // wallet), which would make the vault hold more than principal + interest
  // and desync it from the datum. Refuse instead.
  const minVaultLovelace = calculateMinLovelaceFromUTxO(
    coinsPerUtxoByte(lucid),
    {
      txHash: "00".repeat(32),
      outputIndex: 0,
      address: scripts.vaultAddress,
      assets: vaultAssets,
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
      vaultAssets,
    )
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
   * value aligned up to the next slot boundary (see module docs). The CDT
   * to burn comes out of the vault UTxO itself, which locks it since mint.
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

/**
 * Assert the vault UTxO holds exactly 1 of the CDT. The mint policy locks
 * the token inside the vault output, so every genuine CD vault carries it;
 * anything else is a look-alike UTxO whose burn could not be balanced.
 */
function assertVaultHoldsCdt(vaultUtxo: UTxO, unit: Unit): void {
  const quantity = vaultUtxo.assets[unit] ?? 0n;
  if (quantity !== 1n) {
    throw new Error(
      `vaultUtxo holds ${quantity} of the CDT (${unit}); expected exactly 1 — the mint policy locks the CDT inside the vault output, so this is not a genuine CD vault UTxO`,
    );
  }
}

function assertOwnerAddress(ownerAddress: string, datum: CDDatum): void {
  const cred = paymentCredentialOf(ownerAddress);
  if (cred.type !== "Key" || cred.hash !== datum.owner) {
    throw new Error(
      `ownerAddress payment credential (${cred.hash}) does not match the datum's owner (${datum.owner})`,
    );
  }
}

function assertIssuerAddress(issuerAddress: string, datum: CDDatum): void {
  const cred = paymentCredentialOf(issuerAddress);
  if (cred.type !== "Key" || cred.hash !== datum.issuer) {
    throw new Error(
      `issuerAddress payment credential (${cred.hash}) does not match the datum's issuer (${datum.issuer}); the on-chain vault credits the remainder only to the issuer's key`,
    );
  }
}

/**
 * Shared preamble for the vault-spend builders: decode + validate the inline
 * datum, check the owner address, derive the CDT unit, and assert the vault
 * UTxO actually holds the token. Any new spend builder must go through this.
 */
function prepareVaultSpend(
  scripts: CdtScripts,
  vaultUtxo: UTxO,
  ownerAddress: string,
): { datum: CDDatum; unit: Unit } {
  const datum = readVaultDatum(vaultUtxo, scripts);
  assertOwnerAddress(ownerAddress, datum);
  const unit = toUnit(datum.cdt_policy, datum.deposit_id);
  assertVaultHoldsCdt(vaultUtxo, unit);
  return { datum, unit };
}

/**
 * Build the at/after-maturity redemption transaction:
 *
 * - spends the vault UTxO with the `Redeem` redeemer;
 * - sets the validity lower bound to `maturity` (or later), aligned up to a
 *   slot boundary so the on-chain bound is never before `maturity`;
 * - burns the CDT with `BurnCD` (the token comes out of the vault UTxO,
 *   where the mint locked it);
 * - pays the owner `principal + full_interest`;
 * - requires the owner's signature.
 */
export async function buildRedeemTx(
  lucid: LucidEvolution,
  params: RedeemTxParams,
): Promise<RedeemTxResult> {
  const scripts = resolveScripts(lucid, params);
  const { datum, unit } = prepareVaultSpend(
    scripts,
    params.vaultUtxo,
    params.ownerAddress,
  );

  const requested = params.validFrom ?? datum.maturity;
  if (requested < datum.maturity) {
    throw new Error(
      `validFrom (${requested}) must be >= maturity (${datum.maturity})`,
    );
  }
  const lowerBound = ceilToSlotBegin(scripts.network, requested);

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
  /**
   * Address paid the remainder (the issuer / credit union). Its payment
   * credential must be the datum's `issuer` — the on-chain vault credits
   * the remainder only to the issuer's key.
   */
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
 * - burns the CDT with `BurnCD` (the token comes out of the vault UTxO,
 *   where the mint locked it);
 * - pays the owner `principal + accrued(t) - penalty_fee(t)`;
 * - pays the remaining vault lovelace back to the issuer;
 * - requires the owner's signature.
 *
 * Sub-min-ADA remainder: if the issuer remainder is positive but below the
 * issuer output's min-ADA, the builder REFUSES to build the transaction
 * (throws) instead of letting Lucid silently top the output up from the
 * wallet, which would pay the issuer more than the vault owes. The on-chain
 * vault only enforces `>= remainder`, so a caller who prefers over-paying
 * min-ADA out of their own pocket can build such a tx manually; realistic
 * CD sizes keep the remainder well above min-ADA, so this only affects
 * dust-sized CDs withdrawn very close to maturity. (The owner payout has no
 * such guard: a below-min-ADA owner output would be topped up from the
 * owner's own wallet — a harmless self-payment.)
 */
export async function buildEarlyWithdrawTx(
  lucid: LucidEvolution,
  params: EarlyWithdrawTxParams,
): Promise<EarlyWithdrawTxResult> {
  const scripts = resolveScripts(lucid, params);
  const { datum, unit } = prepareVaultSpend(
    scripts,
    params.vaultUtxo,
    params.ownerAddress,
  );
  assertIssuerAddress(params.issuerAddress, datum);

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
  // Derived from the vault's ACTUAL lovelace, not the datum: for a genuine
  // vault the two coincide (the mint enforces >= principal + full interest,
  // and buildMintTx funds exactly that), and if a vault was ever over-funded
  // the surplus flows to the issuer rather than being silently kept.
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
        `Issuer remainder (${remainder} lovelace) is below the issuer output's min-ADA (${minIssuerLovelace} lovelace), so it cannot be paid out exactly: Lucid would silently top the output up from the wallet, paying the issuer more than the vault owes. Refusing to build; withdraw at a slightly earlier time (larger remainder) or build the top-up transaction manually.`,
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
