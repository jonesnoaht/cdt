//// Shared datum and redeemer types for the CDT validators.
////
//// `CDDatum` is the inline datum carried by every CD vault UTxO; it is the
//// single source of truth for the CD terms. The minting policy verifies it
//// at mint time (as the oracle-attested payload of `MintCD`) and the vault
//// enforces it at spend time.

use aiken/crypto.{VerificationKeyHash}
use cardano/assets.{PolicyId}

/// Terms of one certificate of deposit, locked in the vault as inline datum.
pub type CDDatum {
  /// The customer (credit-union member) who owns the CD.
  owner: VerificationKeyHash,
  /// The credit union issuing the CD.
  issuer: VerificationKeyHash,
  /// Bank deposit transaction id; also the CDT asset name.
  deposit_id: ByteArray,
  /// Principal, in lovelace.
  principal: Int,
  /// Annual simple interest rate, in basis points.
  rate_bps: Int,
  /// CD start, POSIXTime in milliseconds.
  start: Int,
  /// CD maturity, POSIXTime in milliseconds.
  maturity: Int,
  /// Early-withdrawal penalty on accrued interest, in basis points.
  penalty_bps: Int,
  /// Policy id of the CDT minting policy that minted this CD's token.
  cdt_policy: PolicyId,
}

/// How the vault UTxO may be spent.
pub type VaultRedeemer {
  /// Redeem at or after maturity: principal + full interest to the owner.
  Redeem
  /// Withdraw before maturity: principal + accrued interest - penalty to
  /// the owner; the remainder back to the issuer.
  EarlyWithdraw
}

/// Redeemer of the CDT minting policy.
pub type MintRedeemer {
  /// Mint one CDT for a verified bank deposit. The datum is the oracle's
  /// attestation payload and must match the vault output's inline datum.
  MintCD { datum: CDDatum }
  /// Burn CDTs. Authorization comes from the vault spend that accompanies
  /// the burn.
  BurnCD
}
