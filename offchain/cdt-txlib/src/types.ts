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
 * On-chain (Aiken) field order:
 * owner, issuer, deposit_id, principal, rate_bps, start, maturity,
 * penalty_bps, cdt_policy, account_id, attestation_hash
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
  /** Bank-core account id (UTF-8), bound by the oracle attestation. */
  account_id: Data.Bytes(),
  /** 32-byte SHA-256 of the canonical oracle attestation payload. */
  attestation_hash: Data.Bytes({ minLength: 32, maxLength: 32 }),
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
