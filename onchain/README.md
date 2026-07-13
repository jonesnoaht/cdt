# CDT on-chain validators

Aiken (Plutus V3) validators for the Certificate of Deposit Token (CDT):
a credit union issues tokenized certificates of deposit on Cardano. An
oracle watcher observes the member's bank deposit, verifies their
credentials, and attests by co-signing the mint transaction. The CDT
native asset (asset name = bank deposit id) is minted while the CD terms
are locked in a vault holding principal + full interest.

## Layout

```
onchain/
├── aiken.toml                  # Aiken v1.1.23, Plutus V3, stdlib v2.2.0
├── lib/cdt/
│   ├── interest.ak             # simple-interest math (integer lovelace, floor division)
│   ├── types.ak                # CDDatum, VaultRedeemer, MintRedeemer
│   ├── checks.ak               # tx-inspection helpers
│   ├── fixtures.ak             # test fixtures (transaction builders)
│   └── interest_test.ak        # unit + property tests for the math
├── validators/
│   ├── cd_vault.ak             # spend validator (+ tests)
│   └── cdt_mint.ak             # mint policy (+ tests)
└── plutus.json                 # CIP-57 blueprint (committed, from `aiken build`)
```

## Interest math (`cdt/interest`)

All amounts are integer lovelace; all divisions floor. `YEAR_MS =
31_557_600_000` (365.25 days).

```
full_interest = principal * rate_bps * (maturity - start) / (10_000 * YEAR_MS)
accrued(t)    = principal * rate_bps * (clamp(t, start, maturity) - start) / (10_000 * YEAR_MS)
penalty_fee   = accrued(t) * penalty_bps / 10_000
early_payout  = principal + accrued(t) - penalty_fee
mature_payout = principal + full_interest
```

## `cd_vault` (spend)

Each CD is one UTxO at the vault, holding `principal + full_interest`
lovelace, the CDT token, and an inline `CDDatum`:

| field         | meaning                                        |
|---------------|------------------------------------------------|
| `owner`       | customer verification key hash                 |
| `issuer`      | credit union verification key hash             |
| `deposit_id`  | bank tx id; also the CDT asset name            |
| `principal`   | lovelace                                       |
| `rate_bps`    | annual simple interest, basis points           |
| `start`       | POSIXTime ms                                   |
| `maturity`    | POSIXTime ms                                   |
| `penalty_bps` | early-withdrawal penalty on accrued interest   |
| `cdt_policy`  | policy id of the CDT minting policy            |

Redeemers:

- `Redeem` — tx signed by `owner`; the validity range's lower bound is
  finite and `>= maturity`; the tx burns exactly 1 of
  `(cdt_policy, deposit_id)`; total lovelace paid to `owner` is
  `>= mature_payout`.
- `EarlyWithdraw` — signed by `owner`; finite lower bound `t` with
  `start <= t < maturity`; burns exactly 1 CDT; `owner` receives
  `>= early_payout(t)`; the remainder (unaccrued interest + penalty fee)
  goes to output(s) at `issuer`.

Both paths additionally require that the transaction spends **exactly one
UTxO from the vault script**. This rules out double-satisfaction attacks in
which a single owner payment (or a single issuer remainder) would satisfy
several vault spends at once; each CD is redeemed or withdrawn in its own
transaction.

## `cdt_mint` (mint), parameterized by `(oracle_vkh, vault_hash)`

Redeemers:

- `MintCD { datum }` — the oracle attestation payload. Requires:
  `oracle_vkh` in `extra_signatories`; exactly +1 of asset name
  `datum.deposit_id` under this policy and nothing else; a vault output at
  `vault_hash` holding the token, `>= principal + full_interest` lovelace,
  and an inline datum structurally equal to `datum` with `cdt_policy` set
  to this policy id; `maturity > start`; `principal > 0`.
- `BurnCD` — only negative amounts of this policy in the mint field.
  Burning is otherwise permissionless: the vault spend is what enforces
  owner signature, maturity and payouts (unlocking the vault *requires* a
  burn, not the other way around). Burning a CDT without spending its vault
  in the same transaction strands the vault funds — a self-inflicted loss
  the on-chain code does not prevent.

There is no hash circularity: the vault compiles standalone; the policy is
parameterized with the vault's script hash; the vault learns the policy id
via its datum, which the policy itself verified at mint time.

### Trust assumptions

- The oracle must never attest the same `deposit_id` twice. Uniqueness of
  the minted asset name is enforced per transaction, not across
  transactions; a duplicate attestation would create a second CDT (and a
  second vault) for the same bank deposit.
- The oracle is trusted to attest only terms that match the bank's records;
  the policy checks their internal consistency (`maturity > start`,
  `principal > 0`, vault fully funded), not their truth.

## Build & test

```sh
export PATH="$HOME/.aiken/bin:$PATH"   # aiken v1.1.23
cd onchain
aiken check   # runs all unit + property tests
aiken build   # regenerates plutus.json (CIP-57 blueprint)
```

To apply the mint policy's parameters and obtain addresses/policy id, use
`aiken blueprint apply` (vault hash first, from
`aiken blueprint policy -m cd_vault` / `aiken blueprint address -m cd_vault`).
