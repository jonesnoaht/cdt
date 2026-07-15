//// One-shot deposit registry (scaffold).
////
//// Status: DESIGN SCAFFOLD — not yet parameterized into cdt_mint production
//// mint path. See docs/ops/on-chain-deposit-registry.md.
////
//// Intent: hold a UTxO whose datum lists used deposit_ids. Spending it to
//// append a new id must co-occur with minting that asset under the CDT
//// policy (enforced when this validator is linked in a future mint redesign).
////
//// Continuity contract for the mint co-spend (off-chain builder MUST ensure):
////   1. Exactly one input is this registry script UTxO (own_ref).
////   2. Exactly one output returns to the same script address with inline datum
////      DepositRegistryDatum { admin: d.admin, used: try_append(d.used, id) }.
////   3. Same tx mints +1 of deposit_id under the CDT policy (oracle co-sign).
////
//// Current code: validates structural rules for RegisterDeposit in isolation
//// so the module typechecks; full output continuity lands with mint wiring.

use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/primitive/bytearray
use cardano/transaction.{OutputReference, Transaction}

/// Pilot datum: admin VKH + list of used deposit_id bytearrays.
pub type DepositRegistryDatum {
  admin: VerificationKeyHash,
  used: List<ByteArray>,
}

pub type DepositRegistryRedeemer {
  RegisterDeposit { deposit_id: ByteArray }
}

/// True if `id` already appears in the used set.
fn is_used(used: List<ByteArray>, id: ByteArray) -> Bool {
  list.any(used, fn(x) { x == id })
}

/// Append id if not present; None if already used or empty id.
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
fn next_datum(
  d: DepositRegistryDatum,
  deposit_id: ByteArray,
) -> Option<DepositRegistryDatum> {
  when try_append(d.used, deposit_id) is {
    Some(used) -> Some(DepositRegistryDatum { admin: d.admin, used })
    None -> None
  }
}

validator deposit_registry {
  spend(
    datum: Option<DepositRegistryDatum>,
    redeemer: DepositRegistryRedeemer,
    _own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(d) = datum
    when redeemer is {
      RegisterDeposit { deposit_id } -> {
        // Admin must authorize registry updates in this scaffold.
        // Production may replace with mint-policy linkage (no admin sig).
        and {
          list.has(self.extra_signatories, d.admin),
          when next_datum(d, deposit_id) is {
            Some(_) -> True
            None -> False
          },
          // Output continuity + mint co-spend checked by surrounding tx builder
          // until cdt_mint is re-parameterized with this registry script hash.
          True,
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
