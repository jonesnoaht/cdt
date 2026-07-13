# @cdt/demo — CDT end-to-end lifecycle demo

The flagship demo for the **Certificate of Deposit Token (CDT)** pilot with
CampusUSA Credit Union: the full lifecycle of a tokenized certificate of
deposit — credential ceremony, fiat funding, oracle-attested minting,
redemption at maturity, and early withdrawal — narrated step by step on an
in-process Cardano emulator. No docker, no testnet, no network access at
runtime.

This package is intentionally **self-contained**: it vendors its own copies of
the on-chain validators (`onchain-vendored/`), a minimal W3C Verifiable
Credentials 1.1 mock (`src/credentials.ts`), and an in-memory core-banking
ledger (`src/bank.ts`). It does not depend on any sibling package in this
repository.

## Quick start

Requirements: Node 22+, npm. Aiken v1.1.23 is optional — the built
`onchain-vendored/plutus.json` is committed, and is rebuilt automatically
before `test`/`demo` when `aiken` is on the `PATH`.

```sh
export PATH="$HOME/.aiken/bin:$PATH"   # optional, for rebuilding the validators
cd offchain/demo
npm ci
npm test        # vitest: unit tests + on-emulator e2e lifecycles
npm run demo    # the narrated end-to-end story
```

## What's inside

| Path | Contents |
| --- | --- |
| `onchain-vendored/` | Complete Aiken project (Plutus V3, stdlib v2): `cd_vault` spending validator + `cdt_mint` minting policy, with unit tests for the interest math |
| `src/interest.ts` | Off-chain bigint mirror of the on-chain interest math |
| `src/credentials.ts` | W3C VC 1.1 mock: did:key-style DIDs, Ed25519 (node:crypto), sorted-key JSON canonicalization, NCUA → credit union → member trust chain |
| `src/bank.ts` | In-memory bank ledger: accounts, CD products, deposits |
| `src/contracts.ts` | Blueprint loading, typed datum/redeemer schemas, parameter application |
| `src/lifecycle.ts` | Emulator setup and the mint / redeem / early-withdraw transactions |
| `src/demo.ts` | The narrated demo (`npm run demo`) |
| `test/` | Vitest suites: exact-lovelace e2e lifecycles + negative cases |

## On-chain design

**Interest math** (integer lovelace, floor division, POSIX-ms times):

```
YEAR_MS = 31_557_600_000
full_interest = principal * rate_bps * (maturity - start) / (10_000 * YEAR_MS)
accrued(t)    = principal * rate_bps * (clamp(t, start, maturity) - start) / (10_000 * YEAR_MS)
penalty_fee   = accrued(t) * penalty_bps / 10_000
early_payout  = principal + accrued(t) - penalty_fee
mature_payout = principal + full_interest
```

**`cd_vault`** (spend) holds the CD: inline `CDDatum` (owner, issuer,
deposit id, principal, rate, term, penalty, CDT policy id), the CDT itself,
and at least `principal + full_interest` lovelace.

- `Redeem` — owner signed; finite validity lower bound ≥ maturity; burns
  exactly 1 CDT; owner receives ≥ `mature_payout`.
- `EarlyWithdraw` — owner signed; finite lower bound `t` with
  `start ≤ t < maturity`; burns the CDT; owner receives ≥ `early_payout(t)`;
  the remainder of the locked lovelace goes to an output at the issuer.

**`cdt_mint`** (mint) is parameterized by `(oracle_vkh, vault_hash)`:

- `MintCD { datum }` — the oracle co-signs (deposit attestation); exactly one
  token named `datum.deposit_id` is minted and nothing else under the policy;
  a vault output holds the token, ≥ `principal + full_interest` lovelace, and
  the inline datum with `cdt_policy` fixed to the policy's own id;
  `maturity > start`, `principal > 0`.
- `BurnCD` — only strictly-negative own-policy amounts.

There is no circular dependency: the vault compiles standalone, the policy
takes the vault hash as a parameter, and the vault learns the policy id
through its datum — which the policy verifies at mint time.

Hardening on top of the base spec:

- **Anti-double-satisfaction**: the vault refuses transactions that spend
  more than one vault UTxO, so a single issuer output (or a single `-1` mint
  entry) can never satisfy the checks of several CD spends at once. The e2e
  suite proves this with a batched-redemption negative test.
- **Datum bounds at mint**: `rate_bps ≥ 0` and `0 ≤ penalty_bps ≤ 10_000`,
  guaranteeing the vault target is at least the principal and that an early
  exit can never pay out less than the principal.

## Sample demo output

```
CERTIFICATE OF DEPOSIT TOKEN (CDT) — END-TO-END LIFECYCLE DEMO
CampusUSA Credit Union pilot, running on a local Lucid emulator

==========================================================================
STEP 1 — Seed the chain: three wallets on a fresh emulator
==========================================================================
  CampusUSA Credit Union (issuer)  addr_test1…fgyg4d  key hash 1019a5f052…9fa957
  Member (customer)              addr_test1…ec30f5  key hash 6089fde494…d897e7
  Deposit oracle (attestor)      addr_test1…3asu7y  key hash dcbb06cad5…3bd23e
  
  cd_vault script address : addr_test1…2pqygz
  cdt_mint policy id      : 1509c697040608dd195a659b66fa71e1dd95dc32abe295ad6ecc06c2
  (policy is parameterized by the oracle key hash and the vault script hash)

==========================================================================
STEP 2 — Credential ceremony: NCUA → credit union → member
==========================================================================
  NCUA root DID         : did:key:z6…fytRje
  Credit union DID      : did:key:z6…T942QU
  Member DID            : did:key:z6…8mUpcy
  
  NCUA issues InsuredInstitutionCredential to the credit union ✔
  Credit union issues AccountHolderCredential to the member ✔
  Member presents both credentials; gate verifies signatures, chain of
  trust (NCUA → credit union → member) and expiry ✔  ONBOARDING PASSES
  
  Counter-example: a tampered AccountHolderCredential (kycLevel edited
  after signing) is REJECTED — "AccountHolderCredential: invalid issuer signature" ✔

==========================================================================
STEP 3 — Member funds a $10,000 CD at the (in-memory) bank
==========================================================================
  Product: 12-month share certificate — 450 bps APR, early-withdrawal
  penalty 1000 bps of accrued interest
  
  Member share account : $15,000.00 (was $25,000.00)
  CD funding account   : $10,000.00
  Deposit dep-001 status  : funded

==========================================================================
STEP 4 — Oracle attests the deposit; CDT is minted and the vault is funded
==========================================================================
  The oracle checked the core-banking ledger and co-signed the mint tx
  together with the credit union (policy requires the oracle signature).
  
  Mint tx              : c7beac69b6…336107
  CDT asset            : 1509c69704…cc06c2.CDT-dep-001
  Vault now holds      : 10,000.001711 ADA + 1 CDT
    principal          : 10,000.000000 ADA
    full interest      : 0.001711 ADA (450 bps × 120 s / year)
  Term                 : start 1783950515107 → maturity 1783950635107 (POSIX ms)
  Bank deposit status  : tokenized

==========================================================================
STEP 5 — Time passes… the CD matures; the member redeems
==========================================================================
  Emulator advanced past maturity (now = 1783950635107).
  The member burns the CDT and the vault releases principal + interest.
  
  Redeem tx            : 6617ee41e2…aee5d2
  Payout to member     : 10,000.001711 ADA (exactly principal + full interest)
  Member balance       : 5,000.000000 ADA → 14,999.670098 ADA (Δ = payout − tx fee of 0.331613 ADA)
  CDT supply           : 0 (burned)
  Bank deposit status  : closed

==========================================================================
STEP 6 — Second CD: the early-withdrawal branch
==========================================================================
  A second $10,000 CD (dep-002) is funded and tokenized the same way.
  Mint tx              : aa23675de5…b3de4e
  At t = start + 60 s the member withdraws early:
  
    accrued interest   : 0.000855 ADA
    penalty (10%)      : 0.000085 ADA
    early payout       : 10,000.000770 ADA (principal + accrued − penalty)
    back to issuer     : 2.000000 ADA (covers the 0.000941 ADA remainder + min-ADA)
  
  Withdraw tx          : 3f19693125…b40761
  Member balance       : 14,999.670098 ADA → 24,997.331503 ADA
  Issuer balance       : 29,999.420808 ADA → 30,001.420808 ADA
  CDT supply           : 0 (burned)

==========================================================================
DEMO COMPLETE — both lifecycles settled to the exact lovelace.
==========================================================================
```

Note: the demo compresses the 12-month term to 120 seconds of emulator time
(and maps $1 ⇒ 1 ADA) so maturity arrives while you watch — the interest math
is identical at any scale.
