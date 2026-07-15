//// CDT minting policy (mint validator), parameterized by the oracle's
//// verification key hash and the CD vault's script hash.
////
//// * `MintCD { datum }` — the oracle watcher saw a verified bank deposit and
////   attests by co-signing the transaction (`oracle_vkh` must be among the
////   extra signatories). Exactly one token named `datum.deposit_id` is
////   minted, and a vault output must lock it together with
////   `principal + full_interest` lovelace and an inline datum structurally
////   equal to the attested one (with `cdt_policy` set to this policy).
//// * `BurnCD` — only burning is allowed under this policy. Burning itself
////   is permissionless: it destroys the holder's claim, and the vault spend
////   is what enforces owner signature, maturity, and payouts (unlocking the
////   vault REQUIRES a burn, not the other way around). A holder who burns
////   their CDT without spending the vault in the same transaction strands
////   the vault funds — a self-inflicted loss the on-chain code does not
////   prevent.
////
//// Trust assumptions:
////
//// * The oracle must never attest the same `deposit_id` twice. Uniqueness
////   of the minted asset name is enforced per transaction, not across
////   transactions; a duplicate attestation would create a second CDT (and
////   second vault) for the same bank deposit.
//// * The oracle is trusted to attest only terms that match the bank's
////   records (this policy checks their internal consistency, not their
////   truth).

use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{ScriptHash, VerificationKeyHash}
use aiken/interval
use aiken/primitive/bytearray
use cardano/address.{Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, Output, Transaction}
use cdt/fixtures.{
  deposit_id, maturity, owner_vkh, principal, rate_bps, sample_datum, start,
}
use cdt/interest
use cdt/types.{BurnCD, CDDatum, MintCD, MintRedeemer}

validator cdt_mint(oracle_vkh: VerificationKeyHash, vault_hash: ScriptHash) {
  mint(redeemer: MintRedeemer, policy_id: PolicyId, self: Transaction) {
    let own_mint = assets.tokens(self.mint, policy_id) |> dict.to_pairs

    when redeemer is {
      MintCD { datum } -> {
        // The vault datum must equal the attested one, with the policy id
        // pinned to this very policy (closing the loop without circular
        // hashes: the vault trusts its datum, and we verify it here).
        let expected_datum: Data = CDDatum { ..datum, cdt_policy: policy_id }
        let min_vault_lovelace = interest.mature_payout(
          datum.principal,
          datum.rate_bps,
          datum.start,
          datum.maturity,
        )
        let locks_cd_in_vault = list.any(
          self.outputs,
          fn(output) {
            when output.address.payment_credential is {
              Script(hash) -> and {
                  hash == vault_hash,
                  assets.quantity_of(output.value, policy_id, datum.deposit_id) == 1,
                  assets.lovelace_of(output.value) >= min_vault_lovelace,
                  output.datum == InlineDatum(expected_datum),
                }
              _ -> False
            }
          },
        )
        and {
          // The oracle attestation (co-sign of this transaction).
          list.has(self.extra_signatories, oracle_vkh),
          // Exactly +1 of the deposit's asset name, and nothing else under
          // this policy.
          own_mint == [Pair(datum.deposit_id, 1)],
          // Sane CD terms.
          datum.maturity > datum.start,
          datum.principal > 0,
          // Issuance linkage: every mint must name a bank account and carry
          // a 32-byte attestation hash binding that account to this deposit.
          bytearray.length(datum.deposit_id) > 0,
          bytearray.length(datum.account_id) > 0,
          bytearray.length(datum.attestation_hash) == 32,
          locks_cd_in_vault,
        }
      }
      BurnCD -> and {
          own_mint != [],
          // Only burning: every amount under this policy is negative.
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

const full: Int = interest.full_interest(principal, rate_bps, start, maturity)

fn mint_one() -> assets.Value {
  assets.from_asset(fixtures.cdt_policy, deposit_id, 1)
}

fn good_vault_output() -> Output {
  fixtures.vault_output(
    fixtures.vault_hash,
    assets.from_lovelace(principal + full)
      |> assets.merge(mint_one()),
    sample_datum(),
  )
}

fn mint_tx() -> Transaction {
  fixtures.tx(
    [fixtures.oracle_vkh, owner_vkh],
    [],
    mint_one(),
    interval.everything,
    [good_vault_output()],
  )
}

fn mint_redeemer() -> MintRedeemer {
  MintCD { datum: sample_datum() }
}

test mint_succeeds() {
  cdt_mint.mint(
    fixtures.oracle_vkh,
    fixtures.vault_hash,
    mint_redeemer(),
    fixtures.cdt_policy,
    mint_tx(),
  )
}

test mint_without_oracle_signature_fails() {
  let tx = Transaction { ..mint_tx(), extra_signatories: [owner_vkh] }
  !cdt_mint.mint(
    fixtures.oracle_vkh,
    fixtures.vault_hash,
    mint_redeemer(),
    fixtures.cdt_policy,
    tx,
  )
}

test mint_of_two_tokens_fails() {
  let two = assets.from_asset(fixtures.cdt_policy, deposit_id, 2)
  let tx = Transaction { ..mint_tx(), mint: two }
  !cdt_mint.mint(
    fixtures.oracle_vkh,
    fixtures.vault_hash,
    mint_redeemer(),
    fixtures.cdt_policy,
    tx,
  )
}

test mint_with_extra_asset_name_fails() {
  let extra = mint_one()
    |> assets.merge(assets.from_asset(fixtures.cdt_policy, "SNEAKY", 1))
  let tx = Transaction { ..mint_tx(), mint: extra }
  !cdt_mint.mint(
    fixtures.oracle_vkh,
    fixtures.vault_hash,
    mint_redeemer(),
    fixtures.cdt_policy,
    tx,
  )
}

test mint_without_vault_output_fails() {
  let tx = Transaction {
    ..mint_tx(),
    outputs: [fixtures.pay_to_key(owner_vkh, principal + full)],
  }
  !cdt_mint.mint(
    fixtures.oracle_vkh,
    fixtures.vault_hash,
    mint_redeemer(),
    fixtures.cdt_policy,
    tx,
  )
}

test mint_with_underfunded_vault_fails() {
  let short = fixtures.vault_output(
    fixtures.vault_hash,
    assets.from_lovelace(principal + full - 1)
      |> assets.merge(mint_one()),
    sample_datum(),
  )
  let tx = Transaction { ..mint_tx(), outputs: [short] }
  !cdt_mint.mint(
    fixtures.oracle_vkh,
    fixtures.vault_hash,
    mint_redeemer(),
    fixtures.cdt_policy,
    tx,
  )
}

test mint_with_vault_missing_token_fails() {
  let no_token = fixtures.vault_output(
    fixtures.vault_hash,
    assets.from_lovelace(principal + full),
    sample_datum(),
  )
  let tx = Transaction { ..mint_tx(), outputs: [no_token] }
  !cdt_mint.mint(
    fixtures.oracle_vkh,
    fixtures.vault_hash,
    mint_redeemer(),
    fixtures.cdt_policy,
    tx,
  )
}

test mint_with_forged_vault_datum_fails() {
  // The vault datum disagrees with the oracle-attested terms (bigger rate).
  let forged = CDDatum { ..sample_datum(), rate_bps: 10_000 }
  let output = fixtures.vault_output(
    fixtures.vault_hash,
    assets.from_lovelace(principal + full)
      |> assets.merge(mint_one()),
    forged,
  )
  let tx = Transaction { ..mint_tx(), outputs: [output] }
  !cdt_mint.mint(
    fixtures.oracle_vkh,
    fixtures.vault_hash,
    mint_redeemer(),
    fixtures.cdt_policy,
    tx,
  )
}

test mint_with_wrong_datum_policy_fails() {
  // The vault datum points at some other minting policy.
  let wrong_policy = CDDatum {
    ..sample_datum(),
    cdt_policy: #"12345678901234567890123456789012345678901234567890123456",
  }
  let output = fixtures.vault_output(
    fixtures.vault_hash,
    assets.from_lovelace(principal + full)
      |> assets.merge(mint_one()),
    wrong_policy,
  )
  let tx = Transaction { ..mint_tx(), outputs: [output] }
  !cdt_mint.mint(
    fixtures.oracle_vkh,
    fixtures.vault_hash,
    mint_redeemer(),
    fixtures.cdt_policy,
    tx,
  )
}

test mint_with_inverted_term_fails() {
  // maturity <= start must be rejected.
  let bad = CDDatum { ..sample_datum(), maturity: start }
  let output = fixtures.vault_output(
    fixtures.vault_hash,
    assets.from_lovelace(principal)
      |> assets.merge(mint_one()),
    bad,
  )
  let tx = Transaction { ..mint_tx(), outputs: [output] }
  !cdt_mint.mint(
    fixtures.oracle_vkh,
    fixtures.vault_hash,
    MintCD { datum: bad },
    fixtures.cdt_policy,
    tx,
  )
}

test mint_with_nonpositive_principal_fails() {
  let bad = CDDatum { ..sample_datum(), principal: 0 }
  let output = fixtures.vault_output(
    fixtures.vault_hash,
    assets.from_lovelace(1_000_000)
      |> assets.merge(mint_one()),
    bad,
  )
  let tx = Transaction { ..mint_tx(), outputs: [output] }
  !cdt_mint.mint(
    fixtures.oracle_vkh,
    fixtures.vault_hash,
    MintCD { datum: bad },
    fixtures.cdt_policy,
    tx,
  )
}

// -- BurnCD ---------------------------------------------------------------------

test burn_succeeds() {
  let tx = fixtures.tx(
    [owner_vkh],
    [],
    assets.from_asset(fixtures.cdt_policy, deposit_id, -1),
    interval.after(maturity),
    [],
  )
  cdt_mint.mint(
    fixtures.oracle_vkh,
    fixtures.vault_hash,
    BurnCD,
    fixtures.cdt_policy,
    tx,
  )
}

test burn_of_several_succeeds() {
  let burn = assets.from_asset(fixtures.cdt_policy, deposit_id, -1)
    |> assets.merge(assets.from_asset(fixtures.cdt_policy, "DEP-2", -3))
  let tx = fixtures.tx([owner_vkh], [], burn, interval.everything, [])
  cdt_mint.mint(
    fixtures.oracle_vkh,
    fixtures.vault_hash,
    BurnCD,
    fixtures.cdt_policy,
    tx,
  )
}

test burn_with_positive_amount_fails() {
  // Sneaking a mint through the burn path must be rejected.
  let burn_and_mint = assets.from_asset(fixtures.cdt_policy, deposit_id, -1)
    |> assets.merge(assets.from_asset(fixtures.cdt_policy, "SNEAKY", 1))
  let tx = fixtures.tx([owner_vkh], [], burn_and_mint, interval.everything, [])
  !cdt_mint.mint(
    fixtures.oracle_vkh,
    fixtures.vault_hash,
    BurnCD,
    fixtures.cdt_policy,
    tx,
  )
}

test burn_with_empty_mint_fails() {
  let tx = fixtures.tx([owner_vkh], [], assets.zero, interval.everything, [])
  !cdt_mint.mint(
    fixtures.oracle_vkh,
    fixtures.vault_hash,
    BurnCD,
    fixtures.cdt_policy,
    tx,
  )
}
