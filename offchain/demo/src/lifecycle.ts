/**
 * On-chain lifecycle helpers for the CDT demo: emulator setup, CDT mint
 * (oracle-attested), redemption at maturity, and early withdrawal.
 *
 * Shared between the narrated demo (src/demo.ts) and the vitest e2e suite.
 *
 * The validators come straight from the repository's real CIP-57 blueprint
 * (`onchain/plutus.json`, committed by `aiken build` in `onchain/`); the
 * datum/redeemer schemas, interest math, and the redeem tx builder come from
 * `@cdt/txlib`. Two transactions stay demo-local, matching the on-chain
 * policy where txlib diverges from it:
 *
 * - Mint: the real `cdt_mint` policy requires the freshly minted CDT to sit
 *   IN the vault output (together with principal + full interest and the
 *   inline datum); txlib's `buildMintTx` pays the token to the owner's
 *   wallet instead, which the real policy rejects.
 * - Early withdrawal: with the demo's compressed 120-second term the issuer
 *   remainder is a few hundred lovelace — far below min-ADA — so the demo
 *   tops the issuer output up to min-ADA (the vault only requires
 *   `>= remainder`). txlib's `buildEarlyWithdrawTx` refuses sub-min-ADA
 *   remainders outright. The demo still adopts txlib's bound semantics: the
 *   validity lower bound is aligned UP to a slot boundary and all amounts
 *   are computed at that aligned time.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  calculateMinLovelaceFromUTxO,
  Data,
  Emulator,
  fromText,
  generateEmulatorAccountFromPrivateKey,
  Lucid,
  paymentCredentialOf,
  SLOT_CONFIG_NETWORK,
  slotToUnixTime,
  unixTimeToSlot,
  type EmulatorAccount,
  type LucidEvolution,
  type Network,
  type UTxO,
} from "@lucid-evolution/lucid";

import {
  accrued,
  BPS_DENOMINATOR,
  CDDatum,
  fullInterest,
  maturePayout,
  MintRedeemer,
  penaltyFee,
  buildRedeemTx,
  readVaultDatum,
  resolveCdtScripts,
  VaultRedeemer,
  type Blueprint,
  type CdtScripts,
} from "@cdt/txlib";

const NETWORK = "Custom" as const;

// ---------------------------------------------------------------------------
// Blueprint — the real validators from onchain/plutus.json
// ---------------------------------------------------------------------------

const blueprintUrl = new URL("../../../onchain/plutus.json", import.meta.url);

let cachedBlueprint: Blueprint | undefined;

/** Load the repository's committed CIP-57 blueprint (`onchain/plutus.json`). */
export function loadBlueprint(): Blueprint {
  cachedBlueprint ??= JSON.parse(readFileSync(blueprintUrl, "utf8")) as Blueprint;
  return cachedBlueprint;
}

// ---------------------------------------------------------------------------
// Emulator slot config for @cdt/txlib's own lucid instance
// ---------------------------------------------------------------------------

interface LucidModuleLike {
  SLOT_CONFIG_NETWORK: typeof SLOT_CONFIG_NETWORK;
}

/** Extract a package's ESM entry ("." export, import condition). */
function esmEntryOf(pkg: {
  exports?: Record<string, unknown>;
  module?: unknown;
}): string | undefined {
  const dot = pkg.exports?.["."];
  const imported =
    typeof dot === "string" ? dot : (dot as { import?: unknown } | undefined)?.import;
  if (typeof imported === "string") return imported;
  // Nested conditions form: { import: { types: ..., default: ... } }.
  const nested = (imported as { default?: unknown } | undefined)?.default;
  if (typeof nested === "string") return nested;
  // Deliberately NOT pkg.main: it may point at the CJS build, whose module
  // state is separate from the ESM build txlib actually executes.
  return typeof pkg.module === "string" ? pkg.module : undefined;
}

let cachedTxlibLucid: LucidModuleLike | null | undefined;

/**
 * Locate and import the @lucid-evolution/lucid ESM module *as resolved from
 * @cdt/txlib's real location*, or `null` when txlib shares the demo's lucid
 * instance (deduped). Cached — the module reference never changes within a
 * process. Throws loudly on any unexpected layout: a silent no-op here would
 * surface later as inscrutable NaN slot math inside txlib's builders.
 */
async function txlibLucidModule(): Promise<LucidModuleLike | null> {
  if (cachedTxlibLucid !== undefined) return cachedTxlibLucid;

  // Both resolve through real (symlink-free) paths. `require.resolve` honors
  // the "require" export condition (dist/index.cjs) — good enough to locate
  // the package on disk, but NOT to import: the CJS build has its own module
  // state, so we must find and import the ESM entry instead.
  const requireFromDemo = createRequire(import.meta.url);
  const txlibEntry = requireFromDemo.resolve("@cdt/txlib");
  const lucidEntryFromTxlib = createRequire(txlibEntry).resolve(
    "@lucid-evolution/lucid",
  );
  if (lucidEntryFromTxlib === requireFromDemo.resolve("@lucid-evolution/lucid")) {
    cachedTxlibLucid = null; // deduped — txlib shares the demo's lucid instance
    return cachedTxlibLucid;
  }

  // Walk up from the resolved entry to the package root.
  let packageRoot = dirname(lucidEntryFromTxlib);
  for (;;) {
    const pkgPath = join(packageRoot, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        name?: string;
        exports?: Record<string, unknown>;
        module?: unknown;
      };
      if (pkg.name === "@lucid-evolution/lucid") {
        const esmEntry = esmEntryOf(pkg);
        if (!esmEntry) {
          throw new Error(
            `Cannot determine the ESM entry of ${pkgPath} (exports shape changed?); ` +
              "fix esmEntryOf in offchain/demo/src/lifecycle.ts",
          );
        }
        cachedTxlibLucid = (await import(
          pathToFileURL(join(packageRoot, esmEntry)).href
        )) as LucidModuleLike;
        return cachedTxlibLucid;
      }
    }
    const parent = dirname(packageRoot);
    if (parent === packageRoot) {
      throw new Error(
        `Could not locate the @lucid-evolution/lucid package root above ${lucidEntryFromTxlib}`,
      );
    }
    packageRoot = parent;
  }
}

/**
 * @cdt/txlib is an npm `file:` link and resolves its own copy of
 * @lucid-evolution/lucid (from offchain/cdt-txlib/node_modules), whose
 * module-global `SLOT_CONFIG_NETWORK` is separate from the demo's. Creating
 * `Lucid(emulator, "Custom")` configures the Custom slot config only in the
 * demo's copy; without mirroring it, txlib's builders cannot convert
 * emulator times to slots (their slot math yields NaN).
 *
 * Must run after `Lucid(emulator, "Custom")`, and again for every new
 * emulator — each one installs a fresh Custom config with its own zeroTime,
 * which also means only the most recently created emulator's contexts are
 * time-valid at any moment (the demo and each test use one emulator at a
 * time).
 *
 * On a real network (Preview/Preprod/Mainnet) the slot configs are static
 * constants baked into every lucid copy, so this is emulator-only plumbing.
 */
async function syncTxlibSlotConfig(): Promise<void> {
  const custom = SLOT_CONFIG_NETWORK.Custom;
  if (!custom || custom.slotLength <= 0) {
    throw new Error(
      'syncTxlibSlotConfig must run after Lucid(emulator, "Custom") has initialized the Custom slot config',
    );
  }
  const lucidFromTxlib = await txlibLucidModule();
  if (lucidFromTxlib === null) return; // single shared lucid instance
  lucidFromTxlib.SLOT_CONFIG_NETWORK.Custom = { ...custom };
}

// ---------------------------------------------------------------------------
// Chain setup
// ---------------------------------------------------------------------------

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
  /** Resolved scripts: vault validator + oracle-parameterized mint policy. */
  contracts: CdtScripts;
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
 * Boot a fresh in-process emulator with three funded wallets and the real
 * validators (from onchain/plutus.json) instantiated against the oracle's
 * key via @cdt/txlib's blueprint resolver.
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
  await syncTxlibSlotConfig();
  const contracts = resolveCdtScripts(lucid, {
    blueprint: loadBlueprint(),
    oracleVkh: oracle.vkh,
  });

  return { emulator, lucid, creditUnion, member, oracle, contracts };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

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

/** `full_interest` over a CD datum's term (via @cdt/txlib). */
export function fullInterestOf(datum: CDDatum): bigint {
  return fullInterest(datum.principal, datum.rate_bps, datum.start, datum.maturity);
}

/** `principal + full_interest` for a CD datum (via @cdt/txlib). */
export function maturePayoutOf(datum: CDDatum): bigint {
  return maturePayout(datum.principal, datum.rate_bps, datum.start, datum.maturity);
}

/**
 * Align a POSIX-ms time UP to the nearest slot boundary — the same rule
 * txlib's builders apply, so the on-chain-visible lower bound is exactly the
 * time the payout amounts are computed at. (txlib keeps its copy private;
 * exporting it there would let this one be deleted.)
 */
export function ceilToSlotBegin(network: Network, timeMs: bigint): bigint {
  const ms = Number(timeMs);
  if (!Number.isSafeInteger(ms)) {
    throw new Error(`time (${timeMs}) is outside the safe integer range`);
  }
  const slot = unixTimeToSlot(network, ms);
  const begin = slotToUnixTime(network, slot);
  if (!Number.isFinite(begin)) {
    throw new Error(
      `slot config for network ${network} is not initialized (slotToUnixTime returned ${begin})`,
    );
  }
  return begin >= ms ? BigInt(begin) : BigInt(slotToUnixTime(network, slot + 1));
}

// ---------------------------------------------------------------------------
// Mint
// ---------------------------------------------------------------------------

export interface CdOnChain {
  datum: CDDatum;
  unit: string;
  /** Lovelace locked at the vault: principal + full interest. */
  locked: bigint;
  mintTxHash: string;
}

/**
 * Mint a CDT: the credit union locks the CDT plus principal + full interest
 * at the vault, and the oracle co-signs to attest that the fiat deposit
 * landed. This transaction is built locally (not via txlib's `buildMintTx`)
 * because the real `cdt_mint` policy requires the token inside the vault
 * output — see the module docs.
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

  // Off-chain term validation, mirroring txlib's buildMintTx: the on-chain
  // policy only enforces principal > 0 and maturity > start, so the issuer
  // must not attest out-of-range terms (a penalty above 100% would eat into
  // the member's principal on early withdrawal).
  if (params.principal <= 0n) {
    throw new Error(`principal must be positive, got ${params.principal}`);
  }
  if (params.rateBps < 0n) {
    throw new Error(`rateBps must be non-negative, got ${params.rateBps}`);
  }
  if (params.termMs <= 0n) {
    throw new Error(`termMs must be positive, got ${params.termMs}`);
  }
  if (params.penaltyBps < 0n || params.penaltyBps > BPS_DENOMINATOR) {
    throw new Error(
      `penaltyBps must be in [0, ${BPS_DENOMINATOR}], got ${params.penaltyBps}`,
    );
  }

  const start = BigInt(emulator.now());
  const maturity = start + params.termMs;
  const datum: CDDatum = {
    owner: member.vkh,
    issuer: creditUnion.vkh,
    deposit_id: depositIdHex,
    principal: params.principal,
    rate_bps: params.rateBps,
    start,
    maturity,
    penalty_bps: params.penaltyBps,
    cdt_policy: contracts.policyId,
    account_id: fromText("1"),
    attestation_hash: "cd".repeat(32),
  };
  const unit = cdtUnit(ctx, depositIdHex);
  const locked = maturePayoutOf(datum);

  lucid.selectWallet.fromPrivateKey(creditUnion.account.privateKey);
  let txBuilder = lucid
    .newTx()
    .mintAssets(
      { [unit]: 1n },
      Data.to({ MintCD: { datum } }, MintRedeemer),
    )
    .attach.MintingPolicy(contracts.mintPolicy)
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

  return { datum, unit, locked, mintTxHash };
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

// ---------------------------------------------------------------------------
// Redeem / early withdrawal
// ---------------------------------------------------------------------------

export interface RedeemResult {
  txHash: string;
  fee: bigint;
  /** Time attested by the tx validity lower bound (POSIX ms, slot-aligned). */
  at: bigint;
  payout: bigint;
}

/**
 * Redeem at (or after) maturity via txlib's `buildRedeemTx`: the member
 * spends the vault UTxO (which carries the CDT), burns the token, and
 * receives principal + full interest in a dedicated output.
 */
export async function redeemCd(ctx: ChainContext, cd: CdOnChain): Promise<RedeemResult> {
  const { lucid, emulator, member } = ctx;
  const now = BigInt(emulator.now());
  const vaultUtxo = await findVaultUtxo(ctx, cd.unit);

  lucid.selectWallet.fromPrivateKey(member.account.privateKey);
  const built = await buildRedeemTx(lucid, {
    // `scripts` short-circuits resolution; blueprint/oracleVkh are still
    // required by txlib's parameter type (and loadBlueprint() is cached).
    blueprint: loadBlueprint(),
    oracleVkh: ctx.oracle.vkh,
    scripts: ctx.contracts,
    vaultUtxo,
    ownerAddress: member.account.address,
    validFrom: now,
  });

  const signed = await built.tx.sign.withWallet().complete();
  const fee = signed.toTransaction().body().fee();
  const txHash = await signed.submit();
  await emulator.awaitTx(txHash);

  return { txHash, fee, at: built.validFrom, payout: built.payout };
}

export interface EarlyWithdrawResult extends RedeemResult {
  /** Interest accrued at the effective (slot-aligned) withdrawal time. */
  accrued: bigint;
  /** Penalty withheld from the accrued interest. */
  penalty: bigint;
  /** Lovelace returned to the issuer's output. */
  issuerReturn: bigint;
  /** Portion of `issuerReturn` mandated by the validator. */
  remainder: bigint;
}

/**
 * Withdraw before maturity: the member burns the CDT, takes
 * principal + accrued - penalty, and the remainder of the locked lovelace is
 * paid back to the issuer (topped up to the output's min-ADA if needed).
 *
 * Built locally rather than via txlib's `buildEarlyWithdrawTx` (which
 * refuses sub-min-ADA remainders instead of topping up — see module docs),
 * but with txlib's bound semantics: the lower bound is the withdrawal time
 * aligned UP to a slot boundary, and all amounts are computed at that
 * aligned time from the on-chain datum.
 */
export async function earlyWithdrawCd(
  ctx: ChainContext,
  cd: CdOnChain,
): Promise<EarlyWithdrawResult> {
  const { lucid, emulator, member, creditUnion, contracts } = ctx;

  const vaultUtxo = await findVaultUtxo(ctx, cd.unit);
  // Decode + sanity-check the on-chain datum with txlib's reader; the
  // on-chain datum (not the caller's in-memory copy) is the source of truth
  // for both the term guard and the payout math.
  const datum = readVaultDatum(vaultUtxo, contracts);

  const now = BigInt(emulator.now());
  if (now < datum.start || now >= datum.maturity) {
    throw new Error("early withdrawal must happen within the term");
  }
  // The on-chain-visible lower bound is slot-aligned; compute the payout at
  // exactly that time so off-chain and on-chain math agree (txlib behavior).
  const t = ceilToSlotBegin(NETWORK, now);
  if (t >= datum.maturity) {
    throw new Error(
      `withdrawal time ${now} aligns to slot boundary ${t}, at/after maturity ${datum.maturity}`,
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
  const remainder = (vaultUtxo.assets["lovelace"] ?? 0n) - payout;

  // The vault validator only requires `>= remainder` at the issuer, but the
  // ledger requires every output to carry min-ADA; top up if needed (the
  // member's wallet funds the difference).
  const protocolParameters = lucid.config().protocolParameters;
  if (!protocolParameters) {
    throw new Error("Lucid instance has no protocol parameters configured");
  }
  const minIssuerLovelace = calculateMinLovelaceFromUTxO(
    protocolParameters.coinsPerUtxoByte,
    {
      txHash: "00".repeat(32),
      outputIndex: 0,
      address: creditUnion.account.address,
      assets: { lovelace: remainder > 0n ? remainder : 1_000_000n },
    },
  );
  const issuerReturn = remainder > minIssuerLovelace ? remainder : minIssuerLovelace;

  lucid.selectWallet.fromPrivateKey(member.account.privateKey);
  const tx = await lucid
    .newTx()
    .collectFrom([vaultUtxo], Data.to("EarlyWithdraw", VaultRedeemer))
    .attach.SpendingValidator(contracts.vaultValidator)
    .mintAssets({ [cd.unit]: -1n }, Data.to("BurnCD", MintRedeemer))
    .attach.MintingPolicy(contracts.mintPolicy)
    .pay.ToAddress(member.account.address, { lovelace: payout })
    .pay.ToAddress(creditUnion.account.address, { lovelace: issuerReturn })
    .addSigner(member.account.address)
    .validFrom(Number(t))
    .complete();

  const signed = await tx.sign.withWallet().complete();
  const fee = signed.toTransaction().body().fee();
  const txHash = await signed.submit();
  await emulator.awaitTx(txHash);

  return {
    txHash,
    fee,
    at: t,
    payout,
    accrued: accruedInterest,
    penalty,
    issuerReturn,
    remainder,
  };
}

// ---------------------------------------------------------------------------
// Ledger inspection
// ---------------------------------------------------------------------------

/** Sum the lovelace held by an address. */
export async function lovelaceAt(ctx: ChainContext, address: string): Promise<bigint> {
  const utxos = await ctx.lucid.utxosAt(address);
  return utxos.reduce((acc, utxo) => acc + (utxo.assets["lovelace"] ?? 0n), 0n);
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
