//// `cdt_mint` — minting policy for Certificate of Deposit Tokens.
////
//// Parameterized by the oracle's verification key hash (the attestation
//// service that confirms the fiat deposit actually landed at the credit
//// union) and by the script hash of the `cd_vault` spending validator.
////
//// There is no circular dependency: the vault compiles standalone, the
//// policy takes the vault hash as a parameter, and the vault learns the
//// policy id through its datum — which this policy verifies at mint time.

use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{ScriptHash, VerificationKeyHash}
use cardano/address.{Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, Transaction}
use cdt/interest
use cdt/types.{BurnCD, CDDatum, MintCD, MintRedeemer}

validator cdt_mint(oracle_vkh: VerificationKeyHash, vault_hash: ScriptHash) {
  mint(redeemer: MintRedeemer, policy_id: PolicyId, self: Transaction) {
    when redeemer is {
      MintCD { datum } -> {
        // The oracle attests to the fiat deposit by co-signing.
        let oracle_signed = list.has(self.extra_signatories, oracle_vkh)
        // Exactly one token, named after the deposit id, and nothing else
        // under this policy.
        let minted_exactly_one =
          (
            self.mint
              |> assets.tokens(policy_id)
              |> dict.to_pairs
          ) == [Pair(datum.deposit_id, 1)]
        // The freshly minted CDT must sit in a vault output that locks the
        // full obligation (principal + full interest) and carries the
        // attested datum inline, with `cdt_policy` fixed to this policy.
        let expected_datum = CDDatum { ..datum, cdt_policy: policy_id }
        let locked_target =
          datum.principal + interest.full_interest(
            datum.principal,
            datum.rate_bps,
            datum.start,
            datum.maturity,
          )
        let vault_funded =
          list.any(
            self.outputs,
            fn(output) {
              and {
                output.address.payment_credential == Script(vault_hash),
                assets.quantity_of(output.value, policy_id, datum.deposit_id) == 1,
                assets.lovelace_of(output.value) >= locked_target,
                when output.datum is {
                  InlineDatum(data) ->
                    if data is out_datum: CDDatum {
                      out_datum == expected_datum
                    } else {
                      False
                    }
                  _ -> False
                },
              }
            },
          )
        and {
          oracle_signed?,
          minted_exactly_one?,
          vault_funded?,
          (datum.maturity > datum.start)?,
          (datum.principal > 0)?,
          // Hardening beyond the base spec: a non-negative rate keeps the
          // vault target >= principal, and a penalty capped at 100% of the
          // accrued interest guarantees early_payout >= principal — the
          // member can never lose principal on an early exit.
          (datum.rate_bps >= 0)?,
          (datum.penalty_bps >= 0 && datum.penalty_bps <= 10_000)?,
        }
      }
      BurnCD ->
        // Burning only: every own-policy amount must be strictly negative.
        self.mint
          |> assets.tokens(policy_id)
          |> dict.to_pairs
          |> list.all(fn(pair) { pair.2nd < 0 })
    }
  }

  else(_) {
    fail
  }
}
