# @cdt/oracle-watcher

The **oracle watcher** for the Certificate of Deposit Token (CDT) project. It
polls the credit union's bank Postgres for unattested CD-funding deposits,
verifies the member's W3C verifiable-credential presentation, and emits a
**signed attestation** that authorizes minting a CDT native asset on Cardano.

```
member deposit -> bank Postgres -> [oracle watcher] -> signed attestation -> CDT mint
```

This package is fully standalone: it vendors its own copy of the bank schema
(`test/fixtures/schema.sql`, owned by the bank-sim unit) and a mock VC
verifier (`src/vc-mock.ts`, the real credentials stack is owned by a sibling
unit).

## What it does

Every poll interval, the watcher queries:

```sql
transactions t JOIN accounts a JOIN cd_products p
WHERE t.kind = 'deposit' AND t.attested = false
  AND a.kind = 'cd_funding' AND t.product_id IS NOT NULL
```

For each pending deposit it:

1. **Validates the minimum** — skips (and logs) deposits with
   `amount_cents < product.min_deposit_cents`.
2. **Verifies the member's VC presentation** via the pluggable
   `verifyPresentation(memberDid, deposit)` hook. The vendored mock verifier
   checks Ed25519 signatures (node:crypto) over deterministically canonicalized
   JSON (sorted keys), walks the issuer chain **NCUA → credit union → member**,
   enforces credential expiry, and checks that the presentation is signed by
   the expected holder. Failed verification: skip + log, no attestation.
3. **Builds the attestation payload**:

   ```json
   {
     "deposit_id": "<String(transactions.id)>",
     "owner": "<accounts.wallet_address>",
     "principal": "<lovelace, see conversion below>",
     "rate_bps": 450,
     "start": "<now, epoch ms>",
     "maturity": "<start + term_months * 2629800000 ms>",
     "penalty_bps": 200
   }
   ```

4. **Signs** the canonicalized payload with the oracle's Ed25519 key. The
   stored/emitted attestation is
   `{ payload, signature, algorithm: "Ed25519", oracle_public_key }`
   (signature and key are base64; the key is SPKI DER).
5. **Records it atomically** — in one DB transaction it INSERTs into
   `attestations` and sets `transactions.attested = true`. Idempotency is
   guaranteed by the `attested = false` filter, a conditional UPDATE, and the
   `attestations.transaction_id` UNIQUE constraint (`ON CONFLICT DO NOTHING`)
   — a deposit can never be double-attested. If an attestation row already
   exists for a deposit still flagged unattested (external repair/race), the
   watcher reconciles the flag without signing a second attestation.
6. **Invokes** the pluggable `onAttested(attestation)` callback. A demo wires
   this to CDT minting; the tests wire it to a spy. Delivery is
   **at-least-once within the process lifetime**: the attestation is
   committed first, and if the callback throws it is retried at the start of
   every subsequent poll cycle. Across restarts, consumers must reconcile
   undelivered attestations from the `attestations` table.

### Demo currency conversion

`principal` is expressed in **lovelace**. For this demo we peg
**1 USD = 1 ADA**, so `1 cent = 10,000 lovelace`
(`principal = amount_cents * 10_000`). A production deployment would use a
price feed or a stable-denominated asset instead — see `LOVELACE_PER_CENT`
in `src/attestation.ts`.

### Maturity

`maturity = start + term_months × 2,629,800,000 ms`, where 2,629,800,000 ms
is the average Gregorian month (365.2425 days / 12).

## Usage as a library

```ts
import pg from 'pg';
import { OracleWatcher, generateEd25519KeyPair } from '@cdt/oracle-watcher';

const watcher = new OracleWatcher({
  pool: new pg.Pool({ /* bank DB */ }),
  oraclePrivateKey: generateEd25519KeyPair().privateKey, // or privateKeyFromPem(...)
  verifyPresentation: async (memberDid, deposit) => {
    // fetch + verify the member's VC presentation; see src/vc-mock.ts
    return { verified: true };
  },
  onAttested: async (attestation) => {
    // hand off to the CDT minting pipeline
  },
  pollIntervalMs: 5000,
});
watcher.start();
// ...
await watcher.stop();
```

Downstream verifiers check attestations with
`verifyAttestation(signed, oraclePublicKey)`.

**Security note:** the `oracle_public_key` field embedded in a signed
attestation is advisory metadata and is not covered by the signature.
Verifiers must always pass a **pinned, out-of-band oracle key** to
`verifyAttestation` — never the key carried inside the attestation itself.
The vendored mock VC verifier likewise performs no challenge/nonce binding
(presentations are replayable while the member credential is valid); a
production verifier must bind a per-request challenge into the presentation
proof.

## CLI

```sh
npm start
```

Runs the poller against an env-configured Postgres:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PGHOST` | `127.0.0.1` | bank DB host |
| `PGPORT` | `55433` | bank DB port (matches the test compose file) |
| `PGUSER` / `PGPASSWORD` | `cdt` / `cdt` | credentials |
| `PGDATABASE` | `cdt_bank` | database |
| `POLL_INTERVAL_MS` | `5000` | poll interval |
| `ORACLE_SIGNING_KEY_PEM` | *(ephemeral key generated)* | Ed25519 private key, PKCS#8 PEM |

Note: the standalone CLI runs in **demo mode** with an accept-all VC hook
(every acceptance is logged); real deployments must inject a real
`verifyPresentation` implementation.

## Tests

Integration tests run against a real dockerized Postgres (host port
**55433**, compose project `cdt-oracle-watcher-test`):

```sh
cd offchain/oracle-watcher
npm ci
docker compose -f test/docker-compose.yml up -d --wait
npm test
docker compose -f test/docker-compose.yml down -v
```

Covered: end-to-end poll → verify → sign → record with a spy `onAttested`;
signature verification with the oracle public key; below-minimum and
failed-VC rejection paths; non-CD accounts/product-less deposits ignored;
idempotency across poll cycles and under a simulated race; poller
start/stop/cleanup; and the mock VC verifier's accept/reject paths.
