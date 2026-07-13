//// Shared types for the CDT (Certificate of Deposit Token) validators.

use aiken/crypto.{VerificationKeyHash}
use cardano/assets.{PolicyId}

/// Inline datum carried by every CD vault UTxO.
///
/// All times are POSIX milliseconds. `principal` is expressed in lovelace.
pub type CDDatum {
  /// Member (account holder) allowed to redeem / early-withdraw.
  owner: VerificationKeyHash,
  /// Credit union that issued the certificate of deposit.
  issuer: VerificationKeyHash,
  /// Unique deposit identifier; doubles as the CDT asset name.
  deposit_id: ByteArray,
  /// Principal, in lovelace. Must be > 0.
  principal: Int,
  /// Annual interest rate, in basis points (1/100th of a percent).
  rate_bps: Int,
  /// Term start, POSIX milliseconds.
  start: Int,
  /// Term end (maturity), POSIX milliseconds. Must be > start.
  maturity: Int,
  /// Early-withdrawal penalty applied to accrued interest, in basis points.
  penalty_bps: Int,
  /// Policy id of the CDT minting policy guarding this vault entry.
  cdt_policy: PolicyId,
}

/// Redeemer for the `cd_vault` spending validator.
pub type VaultRedeemer {
  /// Redeem at (or after) maturity for principal + full interest.
  Redeem
  /// Withdraw before maturity for principal + accrued interest - penalty.
  EarlyWithdraw
}

/// Redeemer for the `cdt_mint` minting policy.
pub type MintRedeemer {
  /// Mint one CDT and lock principal + full interest at the vault.
  MintCD { datum: CDDatum }
  /// Burn CDTs (any strictly-negative own-policy amounts).
  BurnCD
}
