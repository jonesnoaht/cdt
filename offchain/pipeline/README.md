# @cdt/pipeline — the CDT issuance service

The runnable product core of the Certificate of Deposit Token prototype: it
glues the bank simulation, the oracle watcher, the credential stack, and the
on-chain validators into one end-to-end flow.

```
bank-sim Postgres ──> OracleWatcher ──> VC verification (@cdt/credentials)
      │                    │
      │              signed attestation
      │                    ▼
      │            IssuanceService ── mint tx (CDT + principal + interest
      │                    │           locked at the cd_vault, co-signed by
      │                    │           issuer wallet + oracle key)
      │                    ▼
      └── attestations.payload.tx_hash ◄── confirmed on chain
                           │
             npm run status / npm run redeem
```

Lifecycle: a member funds a CD at the credit union → the oracle watcher
attests the deposit (after verifying the member's NCUA → credit-union →
member verifiable-credential chain) → the service mints the CDT and locks
`principal + full interest` at the vault → at/after maturity the member
redeems (or early-withdraws with penalty) and the CDT is burned.

## Quick start (full local product, emulator mode)

Requirements: Node 22, npm, Docker.

```sh
# 1. bank database (host port 55432) + demo data
cd bank-sim
npm ci
npm run db:up
npm run seed

# 2. the issuance service (in-process Cardano emulator by default)
cd ../offchain/pipeline
npm ci          # also builds the sibling packages it imports
npm start
```

On boot the service performs the credential ceremony (fresh NCUA root →
credit union → one `AccountHolderCredential` per seeded member) and — in
emulator mode — assigns every member a pre-funded emulator wallet (writing
it to `accounts.wallet_address`; the seeded addresses are placeholders).
Within a poll cycle or two you'll see the three seeded CD deposits get
attested and minted.

In a second terminal:

```sh
cd offchain/pipeline

# 3. make a new deposit through bank-sim's access layer
node --import tsx -e '
  const { createPool, deposit } = await import("../../bank-sim/src/index.ts");
  const pool = createPool();
  console.log(await deposit(pool, { accountId: 2, amountCents: 150_000, productId: 1, memo: "demo CD" }));
  await pool.end();
'
# ...watch the service terminal: attested -> minted

# 4. list every CD (bank DB joined with on-chain vault state)
npm run status

# 5. redeem at maturity (the service time-travels the emulator past maturity)
npm run redeem -- --deposit-id 4

# 6. or withdraw early, with penalty
npm run redeem -- --deposit-id 5 --early
```

In emulator mode the chain lives inside the `npm start` process, so the
status/redeem CLIs talk to its control endpoint (`http://127.0.0.1:8787`;
`GET /health`, `GET /status`, `POST /redeem`) — the handlers run the exact
same `IssuanceService` code paths the CLIs run directly in preview mode.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `CDT_NETWORK` | `emulator` | `emulator` (in-process Lucid Emulator, self-funded wallets) or `preview` (Cardano preview testnet) |
| `CDT_PROVIDER` | `koios` | Preview-mode provider: `koios` or `blockfrost` |
| `CDT_KOIOS_URL` | `https://preview.koios.rest/api/v1` | Koios endpoint |
| `CDT_BLOCKFROST_URL` | `https://cardano-preview.blockfrost.io/api/v0` | Blockfrost endpoint |
| `BLOCKFROST_PROJECT_ID` | — | Required with `CDT_PROVIDER=blockfrost` |
| `CDT_BLUEPRINT_FILE` | `../../onchain/plutus.json` | CIP-57 blueprint from `aiken build` |
| `CDT_ISSUER_SK_FILE` | — | Preview: issuer wallet key (bech32 `ed25519_sk…`) |
| `CDT_ORACLE_SK_FILE` | — | Preview: oracle co-signing key (bech32) — its vkh parameterizes the mint policy |
| `CDT_ORACLE_ATTESTATION_SK_FILE` | — | Preview: oracle attestation key (PKCS#8 PEM) |
| `CDT_MEMBER_SK_FILE` | — | Preview: member key for `npm run redeem` |
| `CDT_SERVICE_PORT` | `8787` | Control endpoint port |
| `CDT_SERVICE_URL` | `http://127.0.0.1:<port>` | Where the CLIs find the service (emulator mode) |
| `POLL_INTERVAL_MS` | `2000` | Oracle watcher poll interval |
| `CDT_MAX_MINT_ATTEMPTS` | `10` | Give up retrying a failing mint after N deliveries |
| `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` | `localhost`/`55432`/`bank`/`bank`/`bank_sim` | Bank database (bank-sim's defaults) |

Key files are never committed (`keys/`, `*.sk`, `*.pem` are gitignored).

## Preview testnet mode

```sh
npm run keygen                      # writes keys/issuer.sk, oracle.sk, member.sk, oracle-attestation.pem
# fund the printed issuer + member addresses from the preview faucet:
# https://docs.cardano.org/cardano-testnets/tools/faucet

export CDT_NETWORK=preview
export CDT_ISSUER_SK_FILE=keys/issuer.sk
export CDT_ORACLE_SK_FILE=keys/oracle.sk
export CDT_ORACLE_ATTESTATION_SK_FILE=keys/oracle-attestation.pem
export CDT_MEMBER_SK_FILE=keys/member.sk
npm start
```

Notes for preview mode:

- the CDT policy id is parameterized by the oracle vkh, so a different
  `keys/oracle.sk` means a different policy (and different asset ids);
- `accounts.wallet_address` must hold real preview addresses whose keys the
  members control (the emulator-mode wallet auto-assignment is skipped);
- the issuer wallet funds `principal + full interest` per mint at the demo
  peg (1 cent = 10,000 lovelace), so fund it generously;
- redemption is only possible at/after maturity on a real network — no
  time travel; `--early` works any time before maturity;
- Koios public tier is rate-limited; use Blockfrost for anything sustained.

## Design notes

- **Idempotent minting.** The watcher delivers attestations at-least-once
  (a failed `onAttested` is re-queued and re-delivered every poll cycle).
  `mintAttested` therefore checks the recorded `tx_hash` in
  `attestations.payload` and the vault UTxO set before building a
  transaction: a `deposit_id` can never be minted twice. A crash between
  submit and DB write-back is reconciled from the chain on redelivery.
- **CDT custody.** The on-chain `cdt_mint` policy requires the minted token
  to sit **in the vault output** together with `principal + full_interest`
  and the inline `CDDatum` — the member's claim is the datum's `owner` key
  hash, and redemption burns the vault-resident token. txlib's `buildMintTx`
  (validated against fixture scripts) pays the token to the owner instead,
  which the real policy rejects, so the pipeline builds its own mint
  transaction (`src/mint.ts`) from txlib's data schemas and interest math.
  txlib's `buildRedeemTx`/`buildEarlyWithdrawTx` work against the real
  validators unchanged and are used as-is.
- **Write-backs.** The pipeline never modifies bank-sim; it merges
  `tx_hash`, `cdt_unit`, `redeem_tx_hash`, `redeem_kind` into the
  `attestations.payload` JSONB with its own SQL (`payload || jsonb_build_object(...)`).
- **Sibling packages** are imported by relative source path (they export TS
  sources / need their own builds); `scripts/build-deps.mjs` (`postinstall`
  / `pretest` / `prestart`) runs `npm ci` in each sibling so a clean
  checkout works with just `npm ci && npm test`. `src/lucid.ts` pins the
  whole package to the same physical `@lucid-evolution/lucid` instance
  txlib resolves — lucid keeps mutable module state (the emulator's slot
  config), so two copies would break validity-bound math.

## Tests

```sh
cd offchain/pipeline
npm ci
docker compose -f test/docker-compose.yml up -d --wait   # Postgres on 55434
npm test
docker compose -f test/docker-compose.yml down -v        # always, even on failure
```

The e2e suite (`test/e2e.test.ts`) drives dockerized Postgres + the Lucid
Emulator through the full product: seed member + product → CD deposit →
one watcher poll cycle → attestation row + mint + vault UTxO with the
correct inline datum → time-travel past maturity → redeem through the same
code path as the CLI → exact-lovelace payout and DB assertions. Negative
paths: failed VC verification never attests/mints; a failing first mint
attempt is re-delivered through the watcher's retry queue and lands exactly
once (no double-mint of a `deposit_id`).
