# @cdt/bank-sim

Simulated credit-union core-banking database for the Certificate of Deposit
Token (CDT) project. It stands in for the bank's Postgres system of record:
members hold checking and CD-funding accounts, CD-funding deposits reference a
CD product, and the oracle watcher polls for unattested CD deposits, then
records an attestation (which marks the deposit attested) for on-chain minting.

## Requirements

- Node 22+, npm
- Docker with the compose plugin

## Quick start

```sh
cd bank-sim
npm ci
docker compose up -d --wait   # starts Postgres 16 and applies schema.sql
npm run seed                  # idempotent: products, members, sample deposits
npm test                      # vitest integration tests against the real DB
docker compose down -v        # stop and remove the data volume
```

## Database

The compose file runs `postgres:16-alpine` as container `cdt-bank-sim-db`
(compose project `cdt-bank-sim`) on host port **55432**. `schema.sql` is
mounted into `/docker-entrypoint-initdb.d`, so the schema is applied
automatically the first time the volume is created. To re-apply it manually
(e.g. after dropping tables): `npm run db:apply`.

Connect with psql:

```sh
psql "postgres://bank:bank@localhost:55432/bank_sim"
# or: PGPASSWORD=bank psql -h localhost -p 55432 -U bank -d bank_sim
```

### Connection environment

All code reads standard Postgres env vars, with these defaults:

| Variable     | Default     |
| ------------ | ----------- |
| `PGHOST`     | `localhost` |
| `PGPORT`     | `55432`     |
| `PGUSER`     | `bank`      |
| `PGPASSWORD` | `bank`      |
| `PGDATABASE` | `bank_sim`  |

### Tables

- `cd_products` — CD offerings (term, rate in bps, early-withdrawal penalty in bps, minimum deposit).
- `accounts` — member accounts (`checking` or `cd_funding`), with the member's Cardano wallet address and DID.
- `transactions` — deposits/withdrawals; CD-funding deposits carry a `product_id` and an `attested` flag.
- `attestations` — one per transaction (UNIQUE), holding the oracle's signed payload.

## Seed data

`npm run seed` truncates everything and repopulates:

- 3 CD products: 6-month (4.00% APR, min $500), 12-month (4.50%, min $1,000),
  60-month (5.00%, min $5,000); all with a 10.00% (1000 bps) penalty.
- 3 members, each with a checking and a cd_funding account, plus did:key DIDs
  and Cardano-style bech32 addresses.
- 3 checking deposits and 3 unattested CD-funding deposits.

## Access layer (`src/`)

```ts
import {
  createPool,
  createAccount,
  deposit,
  listUnattestedCdDeposits,
  recordAttestation,
  getBalances,
} from "@cdt/bank-sim";

const pool = createPool();
const pending = await listUnattestedCdDeposits(pool);
await recordAttestation(pool, pending[0].transactionId, "dep-0001", {
  /* signed payload */
});
```

- `createAccount(db, { memberName, walletAddress, did, kind })`
- `deposit(db, { accountId, amountCents, productId?, memo? })` — validates
  positive integer amounts; CD-funding deposits require a `cd_funding` account
  and must meet the product minimum.
- `listUnattestedCdDeposits(db)` — joins accounts and products; only
  `cd_funding` deposits with a `product_id` and `attested = false`.
- `recordAttestation(pool, transactionId, depositId, payload)` — inserts the
  attestation and flips `attested = true` in one database transaction; a
  duplicate attestation fails on the UNIQUE constraint and changes nothing.
- `getBalances(db, accountId)` — deposit/withdrawal sums and net balance.

## Scripts

| Script              | Purpose                                  |
| ------------------- | ---------------------------------------- |
| `npm run db:up`     | `docker compose up -d --wait`            |
| `npm run db:down`   | `docker compose down -v`                 |
| `npm run db:apply`  | Apply `schema.sql` to the running DB     |
| `npm run seed`      | Idempotent seed (truncate + repopulate)  |
| `npm test`          | Vitest integration tests (needs the DB)  |
| `npm run typecheck` | `tsc --noEmit`                           |
