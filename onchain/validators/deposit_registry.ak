//// One-shot deposit registry — mint co-spend ready.
////
//// Parameter: `cdt_policy` — the CDT mint policy this registry guards.
////
//// RegisterDeposit { deposit_id }:
////   * admin must co-sign
////   * deposit_id not already in used
////   * same tx mints exactly +1 of deposit_id under cdt_policy
////   * (builder continuity) output returns next_datum — enforced off-chain
////     until multi-output inspection is wired; try_append is enforced here.
////
//// See docs/ops/on-chain-deposit-registry.md.

use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/primitive/bytearray
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}

/// Pilot datum: admin VKH + list of used deposit_id bytearrays.
pub type DepositRegistryDatum {
  admin: VerificationKeyHash,
  used: List<ByteArray>,
}

pub type DepositRegistryRedeemer {
  RegisterDeposit { deposit_id: ByteArray }
}

fn is_used(used: List<ByteArray>, id: ByteArray) -> Bool {
  list.any(used, fn(x) { x == id })
}

fn try_append(
  used: List<ByteArray>,
  id: ByteArray,
) -> Option<List<ByteArray>> {
  if bytearray.length(id) == 0 {
    None
  } else if is_used(used, id) {
    None
  } else {
    Some(list.concat(used, [id]))
  }
}

/// Expected successor datum after a successful RegisterDeposit.
pub fn next_datum(
  d: DepositRegistryDatum,
  deposit_id: ByteArray,
) -> Option<DepositRegistryDatum> {
  when try_append(d.used, deposit_id) is {
    Some(used) -> Some(DepositRegistryDatum { admin: d.admin, used })
    None -> None
  }
}

/// True when this tx mints exactly +1 of `deposit_id` under `cdt_policy`.
fn mints_exactly_one(self: Transaction, cdt_policy: PolicyId, deposit_id: ByteArray) -> Bool {
  let pairs = assets.tokens(self.mint, cdt_policy) |> dict.to_pairs
  pairs == [Pair(deposit_id, 1)]
}

validator deposit_registry(cdt_policy: PolicyId) {
  spend(
    datum: Option<DepositRegistryDatum>,
    redeemer: DepositRegistryRedeemer,
    _own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(d) = datum
    when redeemer is {
      RegisterDeposit { deposit_id } -> {
        and {
          list.has(self.extra_signatories, d.admin),
          when next_datum(d, deposit_id) is {
            Some(_) -> True
            None -> False
          },
          // Mint co-spend: same tx must mint exactly one CDT for this deposit.
          mints_exactly_one(self, cdt_policy, deposit_id),
        }
      }
    }
  }

  else(_) {
    fail
  }
}

test append_fresh() {
  try_append([#"aa"], #"bb") == Some([#"aa", #"bb"])
}

test append_duplicate_fails() {
  try_append([#"aa"], #"aa") == None
}

test append_empty_fails() {
  try_append([], #"") == None
}

test next_datum_preserves_admin() {
  let d =
    DepositRegistryDatum {
      admin: #"00112233445566778899aabbccddeeff00112233445566778899aabb",
      used: [#"aa"],
    }
  when next_datum(d, #"bb") is {
    Some(n) -> and {
        n.admin == d.admin,
        n.used == [#"aa", #"bb"],
      }
    None -> False
  }
}
