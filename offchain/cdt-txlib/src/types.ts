/**
 * Plutus data schemas for the Certificate of Deposit Token (CDT).
 *
 * These schemas mirror the on-chain Aiken types EXACTLY, including field
 * order. Any change to the on-chain types must be reflected here or datums
 * and redeemers will fail to decode / validate on-chain.
 */
import { Data } from "@lucid-evolution/lucid";

/**
 * The CD terms datum locked at the vault validator.
 *
 * On-chain (Aiken):
 * ```aiken
 * pub type CDDatum {
 *   owner: VerificationKeyHash,
 *   issuer: ByteArray,
 *   deposit_id: ByteArray,
 *   principal: Int,
 *   rate_bps: Int,
 *   start: Int,      // POSIX ms
 *   maturity: Int,   // POSIX ms
 *   penalty_bps: Int,
 *   cdt_policy: ByteArray,
 * }
 * ```
 */
export const CDDatumSchema = Data.Object({
  owner: Data.Bytes({ minLength: 28, maxLength: 28 }),
  issuer: Data.Bytes(),
  deposit_id: Data.Bytes(),
  principal: Data.Integer(),
  rate_bps: Data.Integer(),
  start: Data.Integer(),
  maturity: Data.Integer(),
  penalty_bps: Data.Integer(),
  cdt_policy: Data.Bytes(),
});
export type CDDatum = Data.Static<typeof CDDatumSchema>;
export const CDDatum = CDDatumSchema as unknown as CDDatum;

/**
 * Redeemer for spending the vault UTxO.
 *
 * `Redeem` is constructor 0 (no fields), `EarlyWithdraw` is constructor 1
 * (no fields).
 */
export const VaultRedeemerSchema = Data.Enum([
  Data.Literal("Redeem"),
  Data.Literal("EarlyWithdraw"),
]);
export type VaultRedeemer = Data.Static<typeof VaultRedeemerSchema>;
export const VaultRedeemer = VaultRedeemerSchema as unknown as VaultRedeemer;

/**
 * Redeemer for the CDT minting policy.
 *
 * `MintCD { datum: CDDatum }` is constructor 0 with a single field (the CD
 * terms being minted against); `BurnCD` is constructor 1 with no fields.
 */
export const MintRedeemerSchema = Data.Enum([
  Data.Object({ MintCD: Data.Object({ datum: CDDatumSchema }) }),
  Data.Literal("BurnCD"),
]);
export type MintRedeemer = Data.Static<typeof MintRedeemerSchema>;
export const MintRedeemer = MintRedeemerSchema as unknown as MintRedeemer;
