//// CD vault (spend validator).
////
//// Holds `principal + full_interest` lovelace for one certificate of
//// deposit, together with the CD terms as an inline `CDDatum`. The matching
//// CDT native asset (asset name = bank deposit id) must be burned to unlock
//// the funds:
////
//// * `Redeem` — at or after maturity, the owner takes principal + full
////   interest.
//// * `EarlyWithdraw` — before maturity, the owner takes principal + accrued
////   interest - penalty; the remainder (unaccrued interest + penalty fee)
////   must be paid back to the issuer.
////
//// Note there is no hash circularity with the minting policy: this vault
//// compiles standalone; the policy is parameterized with this vault's script
//// hash; the vault learns the policy id via its datum (`cdt_policy`), which
//// the policy itself verified at mint time.
////
//// To rule out double-satisfaction attacks (one owner payment or one issuer
//// remainder "satisfying" several vault spends at once), a transaction may
//// spend at most ONE UTxO from this script: each CD must be redeemed or
//// withdrawn in its own transaction.

use aiken/collection/list
use aiken/interval
use cardano/assets
use cardano/transaction.{OutputReference, Transaction, find_input}
use cdt/checks.{finite_lower_bound, lovelace_paid_to_key}
use cdt/fixtures.{
  cdt_policy, deposit_id, issuer_vkh, maturity, owner_vkh, penalty_bps,
  principal, rate_bps, sample_datum, some_output_reference, start,
}
use cdt/interest
use cdt/types.{CDDatum, EarlyWithdraw, Redeem, VaultRedeemer}

validator cd_vault {
  spend(
    datum_opt: Option<CDDatum>,
    redeemer: VaultRedeemer,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(datum) = datum_opt
    let CDDatum {
      owner,
      issuer,
      deposit_id,
      principal,
      rate_bps,
      start,
      maturity,
      penalty_bps,
      cdt_policy,
      account_id: _,
      attestation_hash: _,
    } = datum

    // Common requirements for both paths.
    let signed_by_owner = list.has(self.extra_signatories, owner)
    let burns_exactly_one = assets.quantity_of(
      self.mint,
      cdt_policy,
      deposit_id,
    ) == -1

    // Anti-double-satisfaction: this must be the only input spent from this
    // script in the whole transaction. Otherwise a single owner payment (or
    // a single issuer remainder) could satisfy several vault spends at once.
    expect Some(own_input) = find_input(self.inputs, own_ref)
    let own_payment = own_input.output.address.payment_credential
    let single_vault_input = list.count(
      self.inputs,
      fn(input) { input.output.address.payment_credential == own_payment },
    ) == 1

    when redeemer is {
      Redeem ->
        when finite_lower_bound(self.validity_range) is {
          Some(t) -> and {
              single_vault_input,
              signed_by_owner,
              // The tx cannot execute before maturity.
              t >= maturity,
              burns_exactly_one,
              lovelace_paid_to_key(self.outputs, owner) >= interest.mature_payout(
                principal,
                rate_bps,
                start,
                maturity,
              ),
            }
          None -> False
        }
      EarlyWithdraw ->
        when finite_lower_bound(self.validity_range) is {
          Some(t) -> {
            let payout = interest.early_payout(
              principal,
              rate_bps,
              start,
              maturity,
              penalty_bps,
              t,
            )
            // The vault was funded with principal + full interest; whatever
            // the owner does not take goes back to the issuer.
            let vault_total = interest.mature_payout(
              principal,
              rate_bps,
              start,
              maturity,
            )
            and {
              single_vault_input,
              signed_by_owner,
              t >= start,
              t < maturity,
              burns_exactly_one,
              lovelace_paid_to_key(self.outputs, owner) >= payout,
              lovelace_paid_to_key(self.outputs, issuer) >= vault_total - payout,
            }
          }
          None -> False
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

const mature_payout: Int =
  interest.mature_payout(principal, rate_bps, start, maturity)

fn burn_one() -> assets.Value {
  assets.from_asset(cdt_policy, deposit_id, -1)
}

/// The vault UTxO under test: principal + full interest plus the CDT token.
fn own_vault_input() -> transaction.Input {
  fixtures.vault_input(
    some_output_reference(),
    fixtures.vault_hash,
    assets.from_lovelace(mature_payout)
      |> assets.merge(assets.from_asset(cdt_policy, deposit_id, 1)),
    sample_datum(),
  )
}

/// A second vault UTxO with the same terms, spent in the same transaction
/// (the double-satisfaction attack setup).
fn second_vault_input() -> transaction.Input {
  fixtures.vault_input(
    fixtures.other_output_reference(),
    fixtures.vault_hash,
    assets.from_lovelace(mature_payout)
      |> assets.merge(assets.from_asset(cdt_policy, deposit_id, 1)),
    sample_datum(),
  )
}

fn redeem_tx() -> Transaction {
  fixtures.tx(
    [owner_vkh],
    [own_vault_input()],
    burn_one(),
    interval.after(maturity),
    [fixtures.pay_to_key(owner_vkh, mature_payout)],
  )
}

test redeem_succeeds() {
  cd_vault.spend(
    Some(sample_datum()),
    Redeem,
    some_output_reference(),
    redeem_tx(),
  )
}

test redeem_before_maturity_fails() {
  let tx = Transaction {
    ..redeem_tx(),
    validity_range: interval.after(maturity - 1),
  }
  !cd_vault.spend(Some(sample_datum()), Redeem, some_output_reference(), tx)
}

test redeem_without_lower_bound_fails() {
  let tx = Transaction { ..redeem_tx(), validity_range: interval.everything }
  !cd_vault.spend(Some(sample_datum()), Redeem, some_output_reference(), tx)
}

test redeem_unsigned_fails() {
  let tx = Transaction { ..redeem_tx(), extra_signatories: [] }
  !cd_vault.spend(Some(sample_datum()), Redeem, some_output_reference(), tx)
}

test redeem_signed_by_stranger_fails() {
  let tx = Transaction {
    ..redeem_tx(),
    extra_signatories: [fixtures.other_vkh],
  }
  !cd_vault.spend(Some(sample_datum()), Redeem, some_output_reference(), tx)
}

test redeem_without_burn_fails() {
  let tx = Transaction { ..redeem_tx(), mint: assets.zero }
  !cd_vault.spend(Some(sample_datum()), Redeem, some_output_reference(), tx)
}

test redeem_burning_two_fails() {
  let tx = Transaction {
    ..redeem_tx(),
    mint: assets.from_asset(cdt_policy, deposit_id, -2),
  }
  !cd_vault.spend(Some(sample_datum()), Redeem, some_output_reference(), tx)
}

test redeem_underpaying_owner_fails() {
  let tx = Transaction {
    ..redeem_tx(),
    outputs: [fixtures.pay_to_key(owner_vkh, mature_payout - 1)],
  }
  !cd_vault.spend(Some(sample_datum()), Redeem, some_output_reference(), tx)
}

test redeem_paying_stranger_instead_fails() {
  let tx = Transaction {
    ..redeem_tx(),
    outputs: [fixtures.pay_to_key(fixtures.other_vkh, mature_payout)],
  }
  !cd_vault.spend(Some(sample_datum()), Redeem, some_output_reference(), tx)
}

// -- EarlyWithdraw ------------------------------------------------------------

/// Halfway through the term: accrued = 2_500_000, penalty = 750_000,
/// owner payout = 101_750_000, issuer remainder = 3_250_000.
const halfway: Int = start + interest.year_ms / 2

fn early_tx(t: Int) -> Transaction {
  let payout = interest.early_payout(
    principal,
    rate_bps,
    start,
    maturity,
    penalty_bps,
    t,
  )
  fixtures.tx(
    [owner_vkh],
    [own_vault_input()],
    burn_one(),
    interval.after(t),
    [
      fixtures.pay_to_key(owner_vkh, payout),
      fixtures.pay_to_key(issuer_vkh, mature_payout - payout),
    ],
  )
}

test early_withdraw_succeeds() {
  cd_vault.spend(
    Some(sample_datum()),
    EarlyWithdraw,
    some_output_reference(),
    early_tx(halfway),
  )
}

test early_withdraw_at_start_succeeds() {
  // Zero accrued interest: owner gets exactly the principal back and the
  // issuer recovers the full interest.
  cd_vault.spend(
    Some(sample_datum()),
    EarlyWithdraw,
    some_output_reference(),
    early_tx(start),
  )
}

test early_withdraw_at_maturity_fails() {
  // At/after maturity the Redeem path must be used instead.
  !cd_vault.spend(
    Some(sample_datum()),
    EarlyWithdraw,
    some_output_reference(),
    early_tx(maturity),
  )
}

test early_withdraw_before_start_fails() {
  !cd_vault.spend(
    Some(sample_datum()),
    EarlyWithdraw,
    some_output_reference(),
    early_tx(start - 1),
  )
}

test early_withdraw_unsigned_fails() {
  let tx = Transaction { ..early_tx(halfway), extra_signatories: [] }
  !cd_vault.spend(
    Some(sample_datum()),
    EarlyWithdraw,
    some_output_reference(),
    tx,
  )
}

test early_withdraw_without_burn_fails() {
  let tx = Transaction { ..early_tx(halfway), mint: assets.zero }
  !cd_vault.spend(
    Some(sample_datum()),
    EarlyWithdraw,
    some_output_reference(),
    tx,
  )
}

test early_withdraw_without_issuer_remainder_fails() {
  let payout = interest.early_payout(
    principal,
    rate_bps,
    start,
    maturity,
    penalty_bps,
    halfway,
  )
  // Owner tries to keep everything for themselves.
  let tx = Transaction {
    ..early_tx(halfway),
    outputs: [fixtures.pay_to_key(owner_vkh, mature_payout)],
  }
  and {
    payout < mature_payout,
    !cd_vault.spend(
      Some(sample_datum()),
      EarlyWithdraw,
      some_output_reference(),
      tx,
    ),
  }
}

test early_withdraw_short_issuer_remainder_fails() {
  let payout = interest.early_payout(
    principal,
    rate_bps,
    start,
    maturity,
    penalty_bps,
    halfway,
  )
  let tx = Transaction {
    ..early_tx(halfway),
    outputs: [
      fixtures.pay_to_key(owner_vkh, payout),
      fixtures.pay_to_key(issuer_vkh, mature_payout - payout - 1),
    ],
  }
  !cd_vault.spend(
    Some(sample_datum()),
    EarlyWithdraw,
    some_output_reference(),
    tx,
  )
}

test early_withdraw_without_lower_bound_fails() {
  let tx = Transaction {
    ..early_tx(halfway),
    validity_range: interval.everything,
  }
  !cd_vault.spend(
    Some(sample_datum()),
    EarlyWithdraw,
    some_output_reference(),
    tx,
  )
}

// -- Multi-vault (double satisfaction) and malformed-datum attacks -------------

test redeem_double_satisfaction_fails() {
  // Two vault UTxOs spent in one tx, but the owner is paid (and the token
  // burned) only once. Each spend must reject the transaction.
  let tx = Transaction {
    ..redeem_tx(),
    inputs: [own_vault_input(), second_vault_input()],
  }
  !cd_vault.spend(Some(sample_datum()), Redeem, some_output_reference(), tx)
}

test early_withdraw_double_satisfaction_fails() {
  // Two vault UTxOs spent in one tx; a single issuer remainder would
  // otherwise satisfy both spends, shorting the issuer.
  let tx = Transaction {
    ..early_tx(halfway),
    inputs: [own_vault_input(), second_vault_input()],
  }
  !cd_vault.spend(
    Some(sample_datum()),
    EarlyWithdraw,
    some_output_reference(),
    tx,
  )
}

test spend_with_missing_datum_crashes() fail {
  // A vault UTxO must carry an inline CDDatum; anything else is rejected
  // outright (the validator crashes rather than returning False).
  cd_vault.spend(None, Redeem, some_output_reference(), redeem_tx())
}

test spend_with_foreign_own_ref_crashes() fail {
  // The spent input must be resolvable in the transaction's inputs.
  let tx = Transaction { ..redeem_tx(), inputs: [] }
  cd_vault.spend(Some(sample_datum()), Redeem, some_output_reference(), tx)
}
