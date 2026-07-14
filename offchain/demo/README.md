# @cdt/demo — CDT end-to-end lifecycle demo

The flagship demo for the **Certificate of Deposit Token (CDT)** pilot with
CampusUSA Credit Union: the full lifecycle of a tokenized certificate of
deposit — credential ceremony, fiat funding, oracle-attested minting,
redemption at maturity, and early withdrawal — narrated step by step on an
in-process Cardano emulator. No docker, no testnet, no network access at
runtime, and no Aiken toolchain required.

The demo consumes the repository's real packages:

- **Validators** come from the committed CIP-57 blueprint
  [`onchain/plutus.json`](../../onchain/plutus.json) (built by `aiken build`
  in `onchain/`), read by relative path at runtime.
- **Datum/redeemer schemas, interest math, blueprint resolution, and the
  redeem transaction builder** come from
  [`@cdt/txlib`](../cdt-txlib) (`file:../cdt-txlib`).
- **The verifiable-credential ceremony** (did:key issuers/holders,
  presentations with verifier challenges, trust-chain verification) comes
  from [`@cdt/credentials`](../../credentials) (`file:../../credentials`).

Only the in-memory bank ledger (`src/bank.ts`) and the demo-specific
transaction shapes (see below) live in this package.

## Quick start

Requirements: Node 22+, npm. Nothing else — the file-linked workspace
packages are built automatically.

```sh
cd offchain/demo
npm ci
npm test        # vitest: unit tests + on-emulator e2e lifecycles
npm run demo    # the narrated end-to-end story
```

### How the `file:` dependencies install

`@cdt/txlib` and `@cdt/credentials` compile TypeScript to a git-ignored
`dist/` via their `prepare` scripts. On a fresh checkout, npm runs those
`prepare` scripts mid-`npm ci` — before the packages' own devDependencies
(typescript) exist — so they fail with `tsc: command not found` (npm runs
`prepare` for file:-linked deps even with `ignore-scripts`). The demo
therefore declares them as **optionalDependencies** — a failed optional
install is skipped instead of failing `npm ci` — and repairs the state with
`scripts/build-deps.mjs`, which runs automatically at the start of
`npm test`, `npm run demo`, and `npm run typecheck`: it runs `npm ci` inside
each dependency (installing its toolchain and triggering its `prepare`
build, rebuilding when sources are newer than `dist/`), then re-runs
`npm ci` in the demo if the links were dropped. Once the siblings are built,
subsequent `npm ci` runs install the links directly. One consequence: tools
that bypass the npm scripts (`npx vitest`, IDE test runners) fail with
"Cannot find package '@cdt/txlib'" until `npm test` (or
`npm run build:deps`) has run once after a cold install.

## What's inside

| Path | Contents |
| --- | --- |
| `src/lifecycle.ts` | Emulator setup, blueprint loading (`onchain/plutus.json` + `@cdt/txlib`'s `resolveCdtScripts`), and the mint / redeem / early-withdraw transactions |
| `src/bank.ts` | In-memory bank ledger: accounts, CD products, deposits |
| `src/demo.ts` | The narrated demo (`npm run demo`) |
| `scripts/build-deps.mjs` | Builds the `file:` dependencies (`@cdt/txlib`, `@cdt/credentials`) |
| `test/` | Vitest suites: exact-lovelace e2e lifecycles + negative cases |

## On-chain design

See [`onchain/`](../../onchain) for the validators themselves. In short
(integer lovelace, floor division, POSIX-ms times):

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
  the issuer receives ≥ `mature_payout − early_payout(t)`.
- **Anti-double-satisfaction**: at most ONE vault UTxO may be spent per
  transaction, so a single owner payment (or issuer remainder) can never
  satisfy several CD spends at once. The e2e suite proves this with a
  batched-redemption negative test.

**`cdt_mint`** (mint) is parameterized by `(oracle_vkh, vault_hash)`:

- `MintCD { datum }` — the oracle co-signs (deposit attestation); exactly one
  token named `datum.deposit_id` is minted and nothing else under the policy;
  a vault output holds the token, ≥ `principal + full_interest` lovelace, and
  the inline datum with `cdt_policy` fixed to the policy's own id;
  `maturity > start`, `principal > 0`.
- `BurnCD` — non-empty mint, only strictly-negative own-policy amounts.

There is no circular dependency: the vault compiles standalone, the policy
takes the vault hash as a parameter, and the vault learns the policy id
through its datum — which the policy verifies at mint time.

## Which transactions use `@cdt/txlib`, and which stay local

- **Redeem** uses `buildRedeemTx` as-is (including its behavior of aligning
  the validity lower bound UP to a slot boundary, so the bound the validator
  sees is never before maturity).
- **Mint** is built locally: the real `cdt_mint` policy requires the freshly
  minted CDT to be locked **inside the vault output** (together with
  principal + full interest and the inline datum), while txlib's
  `buildMintTx` pays the token to the owner's wallet — a shape the on-chain
  policy rejects.
- **Early withdrawal** is built locally: with the demo's compressed
  120-second term the issuer remainder is a few hundred lovelace — far below
  min-ADA — so the demo tops the issuer output up to min-ADA (the vault only
  checks `>=`). txlib's `buildEarlyWithdrawTx` refuses sub-min-ADA remainders
  outright. The demo still adopts txlib's bound semantics: the validity lower
  bound is aligned UP to a slot boundary and all payout amounts are computed
  at that aligned time, so off-chain and on-chain math agree exactly.

## Sample demo output

```
CERTIFICATE OF DEPOSIT TOKEN (CDT) — END-TO-END LIFECYCLE DEMO
CampusUSA Credit Union pilot, running on a local Lucid emulator

==========================================================================
STEP 1 — Seed the chain: three wallets on a fresh emulator
==========================================================================
  CampusUSA Credit Union (issuer)  addr_test1…fvzdpj  key hash ad114bc2aa…4eae95
  Member (customer)              addr_test1…jp2m00  key hash 28e73d16e2…ee931e
  Deposit oracle (attestor)      addr_test1…mflz5l  key hash be1d96a9f9…bb8e92
  
  cd_vault script address : addr_test1…8ftf8f
  cdt_mint policy id      : 1f236f996bafc82851aae79e3be7ddca02fc2256d8cc1db80b199426
  (policy is parameterized by the oracle key hash and the vault script hash)

==========================================================================
STEP 2 — Credential ceremony: NCUA → credit union → member
==========================================================================
  NCUA root DID         : did:key:z6…SWnsCP
  Credit union DID      : did:key:z6…1AzGLs
  Member DID            : did:key:z6…p1ebFU
  
  NCUA issues InsuredInstitutionCredential to the credit union ✔
  Credit union issues AccountHolderCredential to the member ✔
  Member presents both credentials against a verifier challenge; the gate
  verifies signatures, the chain of trust (NCUA → credit union → member),
  the required credential types, validity windows, and the challenge ✔
  ONBOARDING PASSES
  
  Counter-example: a tampered AccountHolderCredential (kycLevel edited
  after signing) is REJECTED — "AccountHolderCredential signature is invalid (credential may have been tampered with)" ✔

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
  
  Mint tx              : b7a294bb85…428da9
  CDT asset            : 1f236f996b…199426.CDT-dep-001
  Vault now holds      : 10,000.001711 ADA + 1 CDT
    principal          : 10,000.000000 ADA
    full interest      : 0.001711 ADA (450 bps × 120 s / year)
  Term                 : start 1783991270175 → maturity 1783991390175 (POSIX ms)
  Bank deposit status  : tokenized

==========================================================================
STEP 5 — Time passes… the CD matures; the member redeems
==========================================================================
  Emulator advanced past maturity (now = 1783991390175).
  The member burns the CDT and the vault releases principal + interest
  (transaction built by @cdt/txlib's buildRedeemTx).
  
  Redeem tx            : 104894f0b6…9bf2f6
  Payout to member     : 10,000.001711 ADA (exactly principal + full interest)
  Member balance       : 5,000.000000 ADA → 14,999.691886 ADA (Δ = payout − tx fee of 0.309825 ADA)
  CDT supply           : 0 (burned)
  Bank deposit status  : closed

==========================================================================
STEP 6 — Second CD: the early-withdrawal branch
==========================================================================
  A second $10,000 CD (dep-002) is funded and tokenized the same way.
  Mint tx              : f811ad5423…592235
  At t = start + 60 s (slot-aligned) the member withdraws early:
  
    accrued interest   : 0.000855 ADA
    penalty (10%)      : 0.000085 ADA
    early payout       : 10,000.000770 ADA (principal + accrued − penalty)
    back to issuer     : 0.849070 ADA (covers the 0.000941 ADA remainder + min-ADA)
  
  Withdraw tx          : ebf6a154dd…a98be0
  Member balance       : 14,999.691886 ADA → 24,998.527834 ADA
  Issuer balance       : 29,999.467706 ADA → 30,000.316776 ADA
  CDT supply           : 0 (burned)

==========================================================================
DEMO COMPLETE — both lifecycles settled to the exact lovelace.
==========================================================================
```

Note: the demo compresses the 12-month term to 120 seconds of emulator time
(and maps $1 ⇒ 1 ADA) so maturity arrives while you watch — the interest math
is identical at any scale.
