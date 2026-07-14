/**
 * The oracle-attested mint transaction against the REAL on-chain validators.
 *
 * `@cdt/txlib`'s `buildMintTx` pays the freshly minted CDT to the owner's
 * wallet — but the real `cdt_mint` policy (onchain/validators/cdt_mint.ak)
 * requires the vault output itself to hold the token:
 *
 *     assets.quantity_of(output.value, policy_id, datum.deposit_id) == 1
 *
 * i.e. the CDT lives WITH the locked principal + interest; the member's
 * claim is the datum's `owner` key hash (the vault spend demands the owner's
 * signature and burns the vault-resident token). txlib's builder was proven
 * against always-true fixture scripts and misses this, so the pipeline
 * builds its own mint transaction here — same shape, same txlib data
 * schemas (`CDDatum`, `MintRedeemer`) and interest math, but with the CDT
 * paid into the vault output. txlib's redeem/early-withdraw builders work
 * unchanged against the real validators (the burned token is supplied by
 * the collected vault input).
 */
import {
  Data,
  calculateMinLovelaceFromUTxO,
  paymentCredentialOf,
  toUnit,
  type LucidEvolution,
  type TxSignBuilder,
  type Unit,
} from "./lucid.js";
import {
  BPS_DENOMINATOR,
  CDDatum,
  MintRedeemer,
  assertHexBytes,
  fullInterest,
  type CDTerms,
  type CdtScripts,
} from "../../cdt-txlib/src/index.ts";

export interface VaultMintParams {
  /** Pre-resolved CDT scripts (from txlib's `resolveCdtScripts`). */
  scripts: CdtScripts;
  /** Member address; its payment key hash becomes `CDDatum.owner`. */
  ownerAddress: string;
  terms: CDTerms;
}

export interface VaultMintResult {
  tx: TxSignBuilder;
  datum: CDDatum;
  unit: Unit;
  /** Lovelace locked at the vault: principal + full interest. */
  lockedLovelace: bigint;
}

/**
 * Build the mint transaction the on-chain policy accepts:
 *
 * - mints exactly 1 CDT (asset name = `depositId`) with `MintCD { datum }`;
 * - pays `principal + full_interest` lovelace AND the CDT to the vault,
 *   with the inline `CDDatum`;
 * - requires the oracle as extra signatory (the attestation co-signature).
 *
 * The selected wallet (the issuer) funds principal + interest + fees.
 */
export async function buildVaultMintTx(
  lucid: LucidEvolution,
  params: VaultMintParams,
): Promise<VaultMintResult> {
  const { scripts, terms } = params;
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
  if (terms.principal <= 0n) {
    throw new Error(`terms.principal must be positive, got ${terms.principal}`);
  }
  if (terms.rateBps < 0n) {
    throw new Error(`terms.rateBps must be non-negative, got ${terms.rateBps}`);
  }
  if (terms.start < 0n) {
    throw new Error(`terms.start must be non-negative, got ${terms.start}`);
  }
  if (terms.maturity <= terms.start) {
    throw new Error(
      `terms.maturity (${terms.maturity}) must be > start (${terms.start})`,
    );
  }
  if (terms.penaltyBps < 0n || terms.penaltyBps > BPS_DENOMINATOR) {
    throw new Error(
      `terms.penaltyBps must be in [0, ${BPS_DENOMINATOR}], got ${terms.penaltyBps}`,
    );
  }

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

  // Lucid silently raises a below-minimum output to min-ADA, which would
  // desync the vault value from the datum's terms. Refuse instead.
  const pp = lucid.config().protocolParameters;
  if (!pp) {
    throw new Error("Lucid instance has no protocol parameters configured");
  }
  const minVaultLovelace = calculateMinLovelaceFromUTxO(pp.coinsPerUtxoByte, {
    txHash: "00".repeat(32),
    outputIndex: 0,
    address: scripts.vaultAddress,
    assets: { lovelace: lockedLovelace, [unit]: 1n },
    datum: datumCbor,
  });
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
      { lovelace: lockedLovelace, [unit]: 1n },
    )
    .addSignerKey(scripts.oracleVkh)
    .complete();

  return { tx, datum, unit, lockedLovelace };
}
