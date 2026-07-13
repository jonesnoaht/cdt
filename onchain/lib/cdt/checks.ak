//// Small transaction-inspection helpers shared by the CDT validators.

use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/interval.{Finite}
use cardano/address.{VerificationKey}
use cardano/assets
use cardano/transaction.{Output, ValidityRange}

/// The finite lower bound of a transaction validity range, if any.
///
/// Returns `None` when the lower bound is not finite, forcing validators
/// to reject transactions that do not commit to an earliest execution time.
pub fn finite_lower_bound(range: ValidityRange) -> Option<Int> {
  when range.lower_bound.bound_type is {
    Finite(t) -> Some(t)
    _ -> None
  }
}

/// Total lovelace across all outputs whose payment credential is the given
/// verification key hash.
pub fn lovelace_paid_to_key(
  outputs: List<Output>,
  vkh: VerificationKeyHash,
) -> Int {
  list.foldl(
    outputs,
    0,
    fn(output, total) {
      when output.address.payment_credential is {
        VerificationKey(hash) ->
          if hash == vkh {
            total + assets.lovelace_of(output.value)
          } else {
            total
          }
        _ -> total
      }
    },
  )
}
