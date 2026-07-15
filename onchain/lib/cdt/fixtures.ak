//// Test fixtures: deterministic keys, a sample CD, and transaction builders
//// used by the validator test suites. Not referenced by any validator.

use aiken/crypto.{ScriptHash, VerificationKeyHash}
use cardano/address
use cardano/assets.{PolicyId, Value}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use cdt/interest
use cdt/types.{CDDatum}

// -- Deterministic identities (28-byte hashes) --------------------------------

pub const owner_vkh: VerificationKeyHash =
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

pub const issuer_vkh: VerificationKeyHash =
  #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

pub const oracle_vkh: VerificationKeyHash =
  #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

pub const other_vkh: VerificationKeyHash =
  #"dddddddddddddddddddddddddddddddddddddddddddddddddddddddd"

pub const vault_hash: ScriptHash =
  #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

pub const cdt_policy: PolicyId =
  #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

pub const deposit_id: ByteArray = "DEP-2026-0001"

pub const account_id: ByteArray = "42"

/// 32-byte attestation hash fixture (not a real hash of sample terms).
pub const attestation_hash: ByteArray =
  #"0101010101010101010101010101010101010101010101010101010101010101"

// -- Sample CD terms -----------------------------------------------------------

/// 100 ADA principal, 5% annual rate, 1-year term, 30% penalty on accrued
/// interest. full_interest = 5_000_000; mature_payout = 105_000_000.
pub const principal: Int = 100_000_000

pub const rate_bps: Int = 500

pub const start: Int = 1_700_000_000_000

pub const maturity: Int = start + interest.year_ms

pub const penalty_bps: Int = 3_000

pub fn sample_datum() -> CDDatum {
  CDDatum {
    owner: owner_vkh,
    issuer: issuer_vkh,
    deposit_id,
    principal,
    rate_bps,
    start,
    maturity,
    penalty_bps,
    cdt_policy,
    account_id,
    attestation_hash,
  }
}

// -- Transaction building blocks ----------------------------------------------

pub fn some_output_reference() -> OutputReference {
  OutputReference {
    transaction_id: #"0000000000000000000000000000000000000000000000000000000000000000",
    output_index: 0,
  }
}

/// A second, distinct output reference (for multi-input transactions).
pub fn other_output_reference() -> OutputReference {
  OutputReference {
    transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
    output_index: 1,
  }
}

/// An output paying `lovelace` to a verification-key address.
pub fn pay_to_key(vkh: VerificationKeyHash, lovelace: Int) -> Output {
  Output {
    address: address.from_verification_key(vkh),
    value: assets.from_lovelace(lovelace),
    datum: transaction.NoDatum,
    reference_script: None,
  }
}

/// A vault output at `script` holding `value` with an inline `CDDatum`.
pub fn vault_output(script: ScriptHash, value: Value, datum: CDDatum) -> Output {
  let datum_data: Data = datum
  Output {
    address: address.from_script(script),
    value,
    datum: InlineDatum(datum_data),
    reference_script: None,
  }
}

/// A vault UTxO being spent: `value` locked at `script` with an inline
/// `CDDatum`.
pub fn vault_input(
  output_reference: OutputReference,
  script: ScriptHash,
  value: Value,
  datum: CDDatum,
) -> Input {
  Input { output_reference, output: vault_output(script, value, datum) }
}

/// A transaction skeleton with the given signatories, inputs, mint,
/// validity range and outputs; everything else comes from
/// `transaction.placeholder`.
pub fn tx(
  signatories: List<VerificationKeyHash>,
  inputs: List<Input>,
  mint: Value,
  validity_range: transaction.ValidityRange,
  outputs: List<Output>,
) -> Transaction {
  Transaction {
    ..placeholder,
    extra_signatories: signatories,
    inputs,
    mint,
    validity_range,
    outputs,
  }
}
