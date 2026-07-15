# @cdt/webapp — member portal

The member-facing web portal for the Certificate of Deposit Token (CDT) demo.
A credit-union member can browse CD ("share certificate") rates, open a
certificate through the **bank tokenization wizard** (CIP checklist → product &
amount including $250k → disclosures → book on core → live attest/mint status),
watch it move from **pending** → **active** (attested & tokenized)
→ **matured**, and explore early-withdrawal math that is computed by the exact
same `@cdt/txlib` interest code that mirrors the on-chain validator.

Two processes, one package:

- **API server** (`src/server/`, Hono on Node) — reads the bank-sim Postgres
  directly and serves `/api/*`. Opening a CD writes a CD-funding `transactions`
  row, which the oracle watcher / mint pipeline picks up.
- **Front end** (`src/ui/`, Vite + React) — the portal UI. In dev, Vite
  proxies `/api` to the API server.

## Run it

Prereqs: Node 22, npm, Docker (for the bank-sim database).

```sh
# 1. Start and seed the core-banking database (from the repo root)
cd bank-sim
npm ci
npm run db:up        # Postgres on localhost:55432
npm run seed         # 3 members, 3 CD products, sample deposits

# 2. Start the portal (API on :8787 + UI on :5173)
cd ../webapp
npm ci
npm run dev

# 3. Open http://localhost:5173
#    - Tokenize a CD  → issuing CU desk
#    - Foreign CDT cash-out → correspondent CU desk (no member login required)
```
Seeded CDs appear as **pending** until the oracle watcher attests them (run it
from `offchain/oracle-watcher` if you want to see the full lifecycle live).

To serve the UI from the API server instead of the Vite dev server:
`npm run build && npm run api`, then open http://localhost:8787.

## Environment

| Variable          | Default                             | Purpose                                            |
| ----------------- | ----------------------------------- | -------------------------------------------------- |
| `PGHOST`          | `localhost`                         | Bank-sim Postgres host                             |
| `PGPORT`          | `55432`                             | Bank-sim Postgres port                             |
| `PGUSER`          | `bank`                              | Postgres user                                      |
| `PGPASSWORD`      | `bank`                              | Postgres password                                  |
| `PGDATABASE`      | `bank_sim`                          | Postgres database                                  |
| `PORT`            | `8787`                              | API server port                                    |
| `CHAIN_PROVIDER`  | _(unset)_                           | Set to `koios-preview` to enable on-chain lookups  |
| `KOIOS_BASE_URL`  | `https://preview.koios.rest/api/v1` | Koios endpoint (used only with `koios-preview`)    |
| `VITE_BRAND_NAME` | `CampusUSA Credit Union`            | Portal branding (build-time, front end)            |

The portal works fully offline: without `CHAIN_PROVIDER`, the on-chain lookup
endpoint returns `{ "available": false }` gracefully.

## API

| Endpoint                         | Description                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/products`              | CD catalog with APY computed from `rate_bps`                                                                                              |
| `GET /api/members`               | Members for the demo login picker                                                                                                         |
| `GET /api/members/:id/accounts`  | The member's accounts with balances                                                                                                       |
| `GET /api/members/:id/tokenize-prep` | Bank desk prep: identity, CD funding account, CIP checklist, disclosures, amount presets (incl. $250k)                                  |
| `GET /api/members/:id/cds`       | The member's CDs joined with attestations: derived status (pending / active / matured), terms, tx hash, and txlib-computed projections (`?curve=1` adds the payout curve) |
| `POST /api/members/:id/deposits` | Open a CD: `{ productId, amountCents }`, validated against the product minimum                                                            |
| `GET /api/correspondent/meta`    | Presenting CU name (demo: Gulfside) vs issuer (CampusUSA)                                                                               |
| `GET /api/claims/:ref`           | Lookup a foreign CDT claim by deposit id / tx id for correspondent cash-out                                                             |
| `GET /api/presentments`          | List cash-advance presentments filed at this desk                                                                                       |
| `POST /api/presentments`         | File presentment: CIP checks + advance cash + settlement instructions to issuer                                                         |
| `GET /api/payment/contract`      | Payment-check contract surface (`cdt.payment_check.v1`, freely spendable)                                                               |
| `GET /api/payment/oracle-pubkey` | Pin the payment-oracle Ed25519 key                                                                                                      |
| `POST /api/payment/challenge`    | One-time challenge for payment verify                                                                                                   |
| `POST /api/payment/verify`       | Oracle attestation check for a claim (opt-in terminal security)                                                                         |
| `POST /api/payment/verify-signature` | Re-verify a signed payment check                                                                                                    |
| `GET /api/cds/:depositId/chain`  | Optional on-chain lookup (Koios preview); `{ available: false }` when offline                                                             |

`:id` is any account id belonging to the member (the picker uses the smallest).

## Interest math

All displayed projections are computed server-side by `@cdt/txlib`'s
`interest.ts` (bigint floor division, `YEAR_MS = 31_557_600_000`), imported
directly from its source at `offchain/cdt-txlib/src/interest.ts` — see
`src/server/math.ts` for why the source module is imported rather than the
packaged `dist` build. The UI never reimplements the math; it renders values
and curves returned by the API.

## Tests

API tests run against a dockerized Postgres on port **55435** with bank-sim's
schema (`test/fixtures/schema.sql`) and deterministic fixture data:

```sh
docker compose -f test/docker-compose.yml up -d --wait
npm test
docker compose -f test/docker-compose.yml down -v
```

A repeatable end-to-end smoke test (brings the test DB up, seeds it, starts
the real API server, curls every GET endpoint plus one POST, and always tears
the DB down):

```sh
npm run smoke
```
