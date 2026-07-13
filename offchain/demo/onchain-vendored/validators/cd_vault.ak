//// `cd_vault` — spending validator holding a certificate of deposit.
////
//// Each vault UTxO carries an inline `CDDatum`, the CDT token identified by
//// `(datum.cdt_policy, datum.deposit_id)`, and at least
//// `principal + full_interest` lovelace.
////
//// - `Redeem`: at/after maturity the owner burns the CDT and takes
////   `principal + full_interest`.
//// - `EarlyWithdraw`: before maturity the owner burns the CDT, takes
////   `principal + accrued(t) - penalty`, and the remainder of the locked
////   lovelace goes back to the issuer.

use aiken/collection/list
use aiken/interval.{Finite}
use cardano/address.{VerificationKey}
use cardano/assets
use cardano/transaction.{Output, OutputReference, Transaction, find_input}
use cdt/interest
use cdt/types.{CDDatum, EarlyWithdraw, Redeem, VaultRedeemer}
use aiken/crypto.{VerificationKeyHash}

/// Total lovelace paid to outputs whose payment credential is `vkh`.
fn lovelace_paid_to(outputs: List<Output>, vkh: VerificationKeyHash) -> Int {
  list.foldl(
    outputs,
    0,
    fn(output, acc) {
      if output.address.payment_credential == VerificationKey(vkh) {
        acc + assets.lovelace_of(output.value)
      } else {
        acc
      }
    },
  )
}

validator cd_vault {
  spend(
    datum: Option<CDDatum>,
    redeemer: VaultRedeemer,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(d) = datum
    // The owner must sign, and exactly one CDT must be burned, whichever
    // branch is taken.
    let owner_signed = list.has(self.extra_signatories, d.owner)
    let cdt_burned =
      assets.quantity_of(self.mint, d.cdt_policy, d.deposit_id) == -1
    // Anti-double-satisfaction: exactly one vault UTxO may be spent per
    // transaction. Without this, two vault inputs would each check the SAME
    // output list (e.g. a single issuer output could satisfy the remainder
    // requirement of several early withdrawals at once), and a single -1
    // mint entry would satisfy several burn checks for a duplicated
    // deposit_id.
    expect Some(own_input) = find_input(self.inputs, own_ref)
    let own_cred = own_input.output.address.payment_credential
    let sole_vault_input =
      list.count(
        self.inputs,
        fn(input) { input.output.address.payment_credential == own_cred },
      ) == 1
    // Both branches key off the finite lower bound of the validity interval,
    // which the ledger guarantees is <= the actual time of inclusion... and
    // >= it minus the validity window, so it serves as the attested "now".
    expect Finite(lower) = self.validity_range.lower_bound.bound_type
    when redeemer is {
      Redeem -> {
        let payout =
          interest.mature_payout(d.principal, d.rate_bps, d.start, d.maturity)
        and {
          owner_signed?,
          cdt_burned?,
          sole_vault_input?,
          (lower >= d.maturity)?,
          (lovelace_paid_to(self.outputs, d.owner) >= payout)?,
        }
      }
      EarlyWithdraw -> {
        // Lovelace locked at this vault entry.
        let locked = assets.lovelace_of(own_input.output.value)
        let payout =
          interest.early_payout(
            d.principal,
            d.rate_bps,
            d.start,
            d.maturity,
            d.penalty_bps,
            lower,
          )
        let remainder = locked - payout
        and {
          owner_signed?,
          cdt_burned?,
          sole_vault_input?,
          (lower >= d.start)?,
          (lower < d.maturity)?,
          (lovelace_paid_to(self.outputs, d.owner) >= payout)?,
          (lovelace_paid_to(self.outputs, d.issuer) >= remainder)?,
        }
      }
    }
  }

  else(_) {
    fail
  }
}
