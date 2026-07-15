//// One-shot deposit registry (scaffold).
////
//// Status: DESIGN SCAFFOLD — not yet parameterized into cdt_mint production
//// mint path. See docs/ops/on-chain-deposit-registry.md.
////
//// Intent: hold a UTxO whose datum lists used deposit_ids. Spending it to
//// append a new id must co-occur with minting that asset under the CDT
//// policy (enforced when this validator is linked in a future mint redesign).
////
//// Current code: validates structural rules for RegisterDeposit in isolation
//// so the module typechecks; integration tests will land when mint is wired.

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
          when try_append(d.used, deposit_id) is {
            Some(_next) -> True
            None -> False
          },
          // Continuity of registry output must be checked by the surrounding
          // transaction builder (mint redesign). Scaffold only gates double-id.
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
  try_append([], #"" ) == None
}
