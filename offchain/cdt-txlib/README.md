# @cdt/txlib

Off-chain transaction library for the **Certificate of Deposit Token (CDT)**:
a credit union issues tokenized certificates of deposit on Cardano. This
package provides, on top of [`@lucid-evolution/lucid`](https://github.com/Anastasia-Labs/lucid-evolution):

1. **Plutus data schemas** mirroring the on-chain (Aiken) types exactly,
   field order included;
2. an **interest math mirror** (`bigint`, floor division) matching the
   on-chain arithmetic exactly;
3. **transaction builders** for the full CD lifecycle (mint, redeem at
   maturity, early withdrawal), driven by the CIP-57 blueprint
   (`plutus.json`) produced by `aiken build`.

The package is intentionally independent of the on-chain unit: it consumes
any blueprint with the expected validator interface.

## Requirements

- Node 22+
- npm

## Install & test

```sh
cd offchain/cdt-txlib
npm ci          # also builds dist/ (prepare script)
npm test        # vitest: unit + property tests + emulator smoke tests
npm run typecheck
npm run build   # emit dist/ (ESM + d.ts) for non-TS consumers
```

## Data schemas (`src/types.ts`)

| Type | Encoding |
| --- | --- |
| `CDDatum` | constr 0: `owner (28-byte vkh), issuer, deposit_id, principal, rate_bps, start (POSIX ms), maturity (POSIX ms), penalty_bps, cdt_policy` |
| `VaultRedeemer` | `Redeem` = constr 0, `EarlyWithdraw` = constr 1 (no fields) |
| `MintRedeemer` | `MintCD { datum: CDDatum }` = constr 0, `BurnCD` = constr 1 |

Use with Lucid's `Data`:

```ts
import { Data } from "@lucid-evolution/lucid";
import { CDDatum } from "@cdt/txlib";

const cbor = Data.to(datum, CDDatum);
const back = Data.from(cbor, CDDatum);
```

## Interest math (`src/interest.ts`)

All arithmetic is `bigint` with floor division, mirroring the on-chain math
exactly:

```
YEAR_MS       = 31_557_600_000
full_interest = principal * rate_bps * (maturity - start) / (10_000 * YEAR_MS)
accrued(t)    = principal * rate_bps * (clamp(t, start, maturity) - start) / (10_000 * YEAR_MS)
penalty_fee   = accrued(t) * penalty_bps / 10_000
early_payout  = principal + accrued(t) - penalty_fee
mature_payout = principal + full_interest
```

Exports: `YEAR_MS`, `BPS_DENOMINATOR`, `clamp`, `fullInterest`, `accrued`,
`penaltyFee`, `earlyPayout`, `maturePayout`. Inputs must be non-negative with
`maturity >= start` (enforced), so JS truncating division equals floor
division.

## Transaction builders (`src/builders.ts`)

Each builder takes a `LucidEvolution` instance (with a selected wallet), the
CIP-57 blueprint JSON, and the oracle parameter. The mint policy is
parameterized on-chain by `(oracle_vkh, vault_hash)`; the builders apply
these via `applyParamsToScript` and derive the policy id and vault address
from the blueprint (`resolveCdtScripts`). Pass the returned `scripts` back
via the optional `scripts` param to skip re-resolving on subsequent calls.

Validity bounds are slot-quantized by the ledger, so the builders align
every lower bound **up** to the next slot boundary — the on-chain-visible
bound is never before `maturity` (redeem) and is exactly the time the
early-withdrawal amounts were computed at. The aligned bound is returned as
`validFrom` in the result.

### `buildMintTx(lucid, { blueprint, oracleVkh, ownerAddress, terms })`

- mints exactly 1 CDT with asset name `terms.depositId` (redeemer
  `MintCD { datum }`);
- locks the minted CDT **inside the vault output**, together with
  `principal + full_interest` lovelace and the inline `CDDatum`
  (`cdt_policy` pinned to the applied policy id) — the on-chain `cdt_mint`
  policy requires exactly this shape; a mint paying the CDT anywhere else
  (e.g. to the owner) fails phase-2 validation. Ownership is tracked by
  `CDDatum.owner` (= `ownerAddress`'s payment key hash), not by token
  custody;
- requires the oracle as extra signatory — the oracle watcher attests the
  bank deposit by co-signing.

```ts
const { tx, unit, datum } = await buildMintTx(lucid, {
  blueprint, oracleVkh, ownerAddress, terms,
});
const memberWitness = await tx.partialSign.withWallet();
const oracleWitness = await tx.partialSign.withPrivateKey(oracleKey); // oracle side
const signed = await tx.assemble([memberWitness, oracleWitness]).complete();
await signed.submit();
```

### `buildRedeemTx(lucid, { blueprint, oracleVkh, vaultUtxo, ownerAddress, validFrom? })`

- decodes and validates the vault's inline `CDDatum` (policy id match +
  term ranges — inline datums at a public address are untrusted input), and
  checks the vault UTxO holds exactly 1 CDT (the mint locks it there);
- requires `ownerAddress`'s payment credential to be the datum's `owner`;
- spends the vault UTxO with `Redeem`;
- sets the validity lower bound to `maturity` (or a later `validFrom`),
  aligned up to a slot boundary;
- burns the CDT with `BurnCD` (the token comes out of the vault UTxO);
- pays the owner `principal + full_interest` and requires the owner's
  signature.

### `buildEarlyWithdrawTx(lucid, { blueprint, oracleVkh, vaultUtxo, ownerAddress, issuerAddress, withdrawAt })`

- decodes/validates the datum and checks `ownerAddress` and the vault's CDT
  as above; additionally requires `issuerAddress`'s payment credential to be
  the datum's `issuer` (the on-chain vault credits the remainder only to the
  issuer's key);
- spends the vault UTxO with `EarlyWithdraw`;
- aligns `withdrawAt` up to the next slot boundary `t'` (must stay in
  `[start, maturity)`), uses `t'` both as the validity lower bound and for
  the payout math so on-chain and off-chain amounts agree;
- burns the CDT;
- pays the owner `principal + accrued(t') - penalty_fee(t')` and returns the
  remaining vault lovelace to the issuer.

**Sub-min-ADA issuer remainder:** if the remainder is positive but below the
issuer output's min-ADA, the builder refuses to build (throws) instead of
letting Lucid silently top the output up from the wallet, which would pay
the issuer more than the vault owes. The on-chain vault only enforces
`>= remainder`, so callers who prefer over-paying min-ADA out of pocket can
build that transaction themselves; realistic CD sizes keep the remainder
well above min-ADA, so this only affects dust-sized CDs withdrawn very close
to maturity.

All builders return the unsigned `TxSignBuilder` plus the derived values
(datum, unit, payouts, resolved scripts).

## Tests

- `test/interest.test.ts` — unit tests and `fast-check` property tests on the
  interest math (monotonicity, `accrued <= full_interest`, payout bounds,
  floor-division identity);
- `test/types.test.ts` — encode/decode round-trips and exact constructor
  index / field-order assertions for all datums and redeemers;
- `test/blueprint.test.ts` — CIP-57 script resolution: purpose-suffix title
  matching, `*.else` handler exclusion, ambiguity detection, parameter-count
  and declared-hash cross-checks;
- `test/builders.emulator.test.ts` — smoke tests on Lucid's in-process
  `Emulator` proving the builders produce submittable transactions for all
  three lifecycle steps, using vendored always-succeeds Plutus V3 scripts
  (`test/fixtures/alwaysTrue.ts`) so the tests do not depend on the on-chain
  unit. The always-succeeds scripts cannot enforce the on-chain rules, so
  validation-side behavior (signature requirements, validity bounds, exact
  amounts) is asserted by inspecting the built transactions;
- `test/builders.real-blueprint.emulator.test.ts` — regression tests against
  the REAL blueprint (`../../onchain/plutus.json`, loaded by relative path in
  the test only): the emulator phase-2-evaluates the actual `cdt_mint` /
  `cd_vault` scripts through the full mint → redeem and mint → early-withdraw
  chains, and proves the pre-fix mint shape (CDT paid to the owner instead of
  locked in the vault) fails phase-2 validation.
