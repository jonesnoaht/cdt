//// CDT claim minting policy — bearer credit-claim units (no interest vault).
////
//// * `MintClaim { series_id, amount, maturity }` — oracle co-signs; mints
////   exactly `amount` tokens named `series_id` (facility/series id as asset name).
//// * `BurnClaim` — permissionless burn of claim units (presentment finalize).
////
//// Limit / LOC accounting lives off-chain (core). This policy only enforces
//// oracle-gated mint shape and burn-only negative mints.

use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/primitive/bytearray
use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}

pub type ClaimRedeemer {
  MintClaim { series_id: ByteArray, amount: Int, maturity: Int }
  BurnClaim
}

validator cdt_claim_mint(oracle_vkh: VerificationKeyHash) {
  mint(redeemer: ClaimRedeemer, policy_id: PolicyId, self: Transaction) {
    let own_mint = assets.tokens(self.mint, policy_id) |> dict.to_pairs
    when redeemer is {
      MintClaim { series_id, amount, maturity } -> and {
          list.has(self.extra_signatories, oracle_vkh),
          amount > 0,
          maturity > 0,
          bytearray.length(series_id) > 0,
          own_mint == [Pair(series_id, amount)],
        }
      BurnClaim -> and {
          own_mint != [],
          list.all(own_mint, fn(pair) { pair.2nd < 0 }),
        }
    }
  }

  else(_) {
    fail
  }
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

test mint_claim_redeemer_shape() {
  // Compile-time smoke: redeemer constructors exist.
  let r = MintClaim { series_id: #"736572", amount: 100, maturity: 1 }
  and {
    r == MintClaim { series_id: #"736572", amount: 100, maturity: 1 },
    BurnClaim == BurnClaim,
  }
}
