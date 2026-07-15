# CDT operator and demo manual

**Audience:** engineers running the monorepo, credit-union ops preparing a pilot, anyone giving a live demo.  
**Status:** working local demonstration → production *path* (not certified).  
**Date:** July 2026  

**Related:** [docs index](./README.md) · [production-readiness.md](./production-readiness.md) · [security-audit.md](./security-audit.md) · [network messaging](./network/05-messaging-protocol.md)

---

## 1. What CDT is (one page)

A **Certificate of Deposit Token** is a Cardano native asset that represents a CD **contract** booked at an insured credit union. The deposit cash stays on the CU core; the token is a self-custodied claim with on-chain terms.

| Principle | Meaning |
| --- | --- |
| **Identity** | DID + W3C VCs (mock `did:key` today; production Hyperledger Identus / `did:prism`) — not a commercial KYC SaaS |
| **CIP / OFAC** | Stay at the credit union off-chain; credentials attest that CIP passed |
| **Mint** | Only after oracle co-sign; vault locks principal + interest |
| **Free-spend** | CDT transfers are unconstrained on-chain; merchants may **opt in** to a payment-oracle check |
| **Cash-out at another CU** | Correspondent **burn-and-settle** (SettlementAuth → burn → ACH), not “become the insurer” |

```text
Member ──deposit──► CU core (bank-sim)
                      │
Oracle verifies VC ───┤
                      ▼
              Mint CDT + vault UTxO (Cardano)
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   Mature redeem   Early withdraw   Correspondent presentment
   (owner burn)    (owner burn)     (auth → burn → settle)
```

---

## 2. Repository map

| Path | Role |
| --- | --- |
| `onchain/` | Aiken Plutus V3: `cd_vault`, `cdt_mint`, scaffold `deposit_registry` |
| `offchain/cdt-txlib/` | Interest math, datum codecs, tx builders |
| `offchain/oracle-watcher/` | Poll bank DB → VC gate → signed attestation |
| `offchain/demo/` | **Flagship** full lifecycle on Lucid emulator (no Docker) |
| `offchain/pipeline/` | Issuance service: watch → mint → redeem |
| `offchain/testnet/` | Preview-testnet lifecycle notes |
| `webapp/` | Member portal + desks + settlement APIs |
| `bank-sim/` | Postgres core stand-in (Docker **:55432**) |
| `credentials/` | Mock DID/VC + `HttpIdentusAgent` |
| `docs/` | This manual, whitepaper, network package, ops |

---

## 3. Prerequisites

- **Node.js 22+**
- **Aiken** `v1.1.x` (for on-chain checks): [aiken-lang.org](https://aiken-lang.org)
- **Docker** (only for Postgres bank-sim / package test DBs)
- Optional: Firefox/Chrome for desks

Always install package deps with:

```bash
npm ci --include=dev
```

(If npm is configured with `omit=dev`, bare `npm ci` will miss vitest/tsx.)

---

## 4. Quick starts

### 4.1 Flagship CLI demo (no Docker, no network)

Self-contained credentials + mint + redeem on an in-process emulator.

```bash
cd /home/noahtjones/cdt/offchain/demo
npm ci --include=dev
npm test
npm run demo
```

### 4.2 Bank desks + portal (live UI)

```bash
# Terminal A — bank core
cd /home/noahtjones/cdt/bank-sim
docker compose up -d --wait
npm ci --include=dev
npm run db:apply
npm run seed
# Seeds claims 4 / 5 / 6 (Ada active, Grace active, Satoshi matured)

# Terminal B — webapp API + Vite
cd /home/noahtjones/cdt/webapp
npm ci --include=dev
PGHOST=localhost PGPORT=55432 PGUSER=bank PGPASSWORD=bank PGDATABASE=bank_sim \
  CDT_ALLOW_OPEN_API=1 \
  ALLOW_EPHEMERAL_PAYMENT_ORACLE=1 \
  BURN_VALIDATE_MODE=off \
  SETTLEMENT_RAIL=mock \
  npm run dev
```

| Service | URL |
| --- | --- |
| API health | `http://127.0.0.1:8787/api/health` |
| Portal | `http://localhost:5173/` (prefer `localhost` over `127.0.0.1` if Vite is IPv6-only) |
| OpenAPI | `http://127.0.0.1:8787/api/openapi.json` |

After pulling new code, **restart** `npm run dev` so the API process reloads routes.

### 4.3 On-chain validators

```bash
cd /home/noahtjones/cdt/onchain
aiken check
```

### 4.4 Settlement smoke (API path)

With webapp + bank-sim running (lab open API):

```bash
cd /home/noahtjones/cdt/webapp
CLAIM_REF=6 WALK_IN='Satoshi Tanaka' npm run smoke:settlement
```

Creates presentment → authorize → burn-evidence → accept-burn → settlement-payment. Accept HTTP **200 or 201** on create.

### 4.5 Production env gate (pilot host)

```bash
cd /home/noahtjones/cdt/webapp
NODE_ENV=production \
  CDT_API_KEY=… PGPASSWORD=… \
  ORACLE_SIGNING_KEY_PEM=… \
  npm run check:prod-env
```

Exit `0` means pilot gates clear — **not** a formal certification.

---

## 5. Bank desks (product UX)

### 5.1 Issuer — buy CD / deliver to Lace (`#/open`)

**CampusUSA** desk. **Product position:** member logs into the CU, buys a share
certificate as CDT, and holds control in **Lace** (CIP-30). See
[product-position.md](./product-position.md).

Sequence:

1. CU member session (demo picker / production SSO)
2. **Connect Lace** — destination wallet for certificate control
3. CIP checklist → product/amount → disclosures
4. Book `cd_funding` on core → oracle attests → mint
5. Track delivery; redeem/burn later via Lace on `#/sign`

| Piece | Location |
| --- | --- |
| UI | `webapp/src/ui/pages/OpenCd.tsx` |
| Prep | `GET /api/members/:id/tokenize-prep` |
| Book | `POST /api/members/:id/deposits` |
| CIP-30 | `webapp/src/ui/cip30.ts` (shared with `#/sign`) |

$250,000 = `25_000_000` cents. Surface NCUA share-insurance notes when amounts approach SMSIA; **the token is not NCUSIF insurance**.

### 5.2 Correspondent — foreign CDT cash-out (`#/present`)

**Gulfside** (demo brand) presents a walk-in with a CampusUSA CDT.

1. Lookup claim (`GET /api/claims/:ref`)
2. CIP / OFAC / ownership checkboxes (or server IDV — see §8)
3. File presentment → status **`pending_burn`** (hold until burn)
4. **Authorize** → SettlementAuth (signed, TTL, `burn_required`)
5. **Burn evidence** → `{ "txHash": "<64 hex>" }`
6. **Accept burn** → optional Koios burn validation
7. **Settlement payment** → mock or HTTP ACH; optional `Idempotency-Key`

Walk-in **name must match** holder. Double presentment → **409**.

UI copy: **hold until burn** — not “advance final cash.”

### 5.3 Merchant payment terminal (`#/pay`)

Opt-in **payment-oracle check** before accepting CDT as consideration. Does **not** freeze transfers.

1. Pin oracle pubkey (`GET /api/payment/oracle-pubkey`)
2. Challenge → verify with **required `payerWallet`** matching attested owner
3. Verify Ed25519 signature over canonical JSON of `signedCheck.payload`

Contract: [payment-check-contract.md](./payment-check-contract.md).

### 5.4 Mobile wallet sign (`#/sign`) — **Lace CIP-30**

For redeem/burn txs too large for a QR of raw CBOR:

1. Desk: `POST /api/sign-requests` (or `POST /api/presentments/:id/sign-burn`) with unsigned `cborHex` → claim URL + QR  
2. Open claim page in a browser where **Lace** is installed ([lace.io](https://www.lace.io/))  
3. Click **Connect Lace & sign** — uses CIP-30 `window.cardano.lace.enable()` → `signTx(cbor, partialSign=true)`  
4. Witness set is posted back via `POST /api/sign-requests/:id/complete`  

| Path | Notes |
| --- | --- |
| **Preferred** | Lace extension (Chrome/Brave) or Lace mobile + in-app browser |
| **Also supported** | Other CIP-30 wallets (Eternl, Nami, …) via wallet dropdown |
| **Lab fallback** | Paste witness/signed CBOR if no extension |

QR still encodes only the **claim URL** (not multi-KB CBOR). Bluetooth is not used.

---

## 6. Settlement network APIs

| Step | Method |
| --- | --- |
| Claim lookup | `GET /api/claims/:ref` |
| Presentment | `POST /api/presentments` |
| SettlementAuth | `POST /api/presentments/:id/authorize` |
| BurnEvidence | `POST /api/presentments/:id/burn-evidence` |
| Accept burn | `POST /api/presentments/:id/accept-burn` |
| SettlementPayment | `POST /api/presentments/:id/settlement-payment` |
| Audit events | `GET /api/presentments/:id/events` |
| Deposit registry | `GET /api/deposit-registry/:depositId` |
| Sign burn (QR) | `POST /api/presentments/:id/sign-burn` `{ cborHex }` |
| Settlement pubkey | `GET /api/settlement/pubkey` |
| Mint JWT | `POST /api/auth/token` |
| IDV check | `POST /api/idv/check` |
| Sign request | `POST/GET /api/sign-requests` |

OpenAPI: [openapi/settlement-v1.yaml](./openapi/settlement-v1.yaml).

Legal/ops package: [network/](./network/README.md).

---

## 7. Demo seed claims

After `bank-sim` seed, presentment-ready certificates:

| Claim ref | Holder | Status (typical) | Notes |
| --- | --- | --- | --- |
| **4** | Ada Lovelace | Active | $500 principal scale |
| **5** | Grace Hopper | Active | $2,500 |
| **6** | Satoshi Tanaka | **Matured** | Cash-out path for smoke |

Walk-in names must match holders exactly for presentment.

---

## 8. Identity, credentials, IDV

### Trust chain

```text
NCUA (trusted root)
  └─ InsuredInstitutionCredential → credit union DID
       └─ AccountHolderCredential → member DID
            └─ VerifiablePresentation → oracle (mint gate)
```

### Oracle VC modes

| Mode | Env | Use |
| --- | --- | --- |
| fail_closed | default | Reject presentations |
| credentials | `CDT_VC_MODE=credentials` | Enroll bank DIDs; challenge-bound verify |
| accept_all | `CDT_ORACLE_ACCEPT_ALL_VC=1` | **Lab only** |

### Identus HTTP

```bash
export IDENTUS_MODE=http
export IDENTUS_BASE_URL=https://identus.internal
export IDENTUS_API_TOKEN=…              # optional
export IDENTUS_TRUSTED_ROOTS=did:prism:…
# optional path map — see docs/ops/identus-path-mapping.md
export IDENTUS_PATH_HEALTH=/health
export IDENTUS_PATH_VERIFY=/v1/presentations/verify
export IDENTUS_PATH_ISSUE_ACCOUNT=/v1/credentials/account-holder
```

### Desk CIP / OFAC adapter

```bash
export CDT_IDV_MODE=mock              # lab
# export CDT_IDV_MODE=http CDT_IDV_URL=https://idv.internal/v1/check
# export CDT_IDV_REQUIRE=1            # gate POST /api/presentments
```

`POST /api/idv/check` runs a check without creating a presentment.

---

## 9. Keys, dual control, HSM-shaped signing

### Pilot key ceremony

```bash
cd /home/noahtjones/cdt/webapp
OUT_DIR=./keys-pilot npm run keygen:pilot
# writes PEMs 0600 under keys-pilot/ (gitignored) + pilot.env.example
```

Never commit `*.private.pem` or `keys-pilot/`. Details: [ops/key-ceremony.md](./ops/key-ceremony.md).

### Settlement dual-control cosign

```bash
export SETTLEMENT_SIGNING_KEY_PEM=…              # officer A
export SETTLEMENT_SECONDARY_SIGNING_KEY_PEM=…    # officer B
export SETTLEMENT_DUAL_CONTROL=1
```

Authorize attaches primary + secondary Ed25519 signatures; burn and accept re-verify both.

### Oracle signing providers

| Mode | Env | Notes |
| --- | --- | --- |
| pem | `ORACLE_SIGNING_PROVIDER=pem` + `ORACLE_SIGNING_KEY_PEM` | Default software |
| remote | `ORACLE_SIGNING_PROVIDER=remote` + `ORACLE_REMOTE_SIGNER_URL` | HSM sidecar HTTP |
| hsm | `ORACLE_SIGNING_PROVIDER=hsm` | PKCS#11 stub (fail-closed) |
| ephemeral | `ALLOW_EPHEMERAL_ORACLE_KEY=1` | Lab only |

Lab remote signer:

```bash
cd offchain/oracle-watcher
ORACLE_SIGNING_KEY_PEM=… npm run remote-signer   # :9090
```

### Outbound mTLS (ACH / IDV / Identus)

```bash
export CDT_TLS_CERT_FILE=/etc/cdt/client.crt
export CDT_TLS_KEY_FILE=/etc/cdt/client.key
export CDT_TLS_CA_FILE=/etc/cdt/ca.crt
# never in production:
# CDT_TLS_REJECT_UNAUTHORIZED=0
```

---

## 10. Settlement rail and burn validation

### Settlement rail

| `SETTLEMENT_RAIL` | Behavior |
| --- | --- |
| `mock` | Synthetic ACH-mock trace (lab default) |
| `log` | Mock + console log |
| `http` | `POST SETTLEMENT_ACH_URL` (optional Bearer token + mTLS) |
| `none` | Refuse settlement-payment |

### Burn validation

| `BURN_VALIDATE_MODE` | Behavior |
| --- | --- |
| `off` | Skip chain (lab) |
| `soft` | Chain if available; warn on failure |
| `strict` | Require Koios proof of **exactly −1** mint qty for deposit asset |

```bash
export CHAIN_PROVIDER=koios-preview
export BURN_VALIDATE_MODE=strict
export CDT_POLICY_ID=…    # optional policy pin
```

---

## 11. Institutional auth

| Mechanism | Env | Notes |
| --- | --- | --- |
| Open lab | `CDT_ALLOW_OPEN_API=1` | Local demos only |
| Shared key | `CDT_API_KEY` | All roles |
| Dual keys | `CDT_ISSUER_API_KEY` + `CDT_CORRESPONDENT_API_KEY` | Split desks |
| JWT | `CDT_JWT_SECRET` (≥32 bytes) | `POST /api/auth/token` with a static key mints HS256 role JWT |

**Issuer** routes: authorize, accept-burn, settlement-payment.  
**Correspondent** routes: presentments, burn-evidence.

---

## 12. Deposit registry (off-chain pilot)

Lifecycle: **`attested` → `minted` → `burned`** (unique `deposit_id`).

| Writer | When |
| --- | --- |
| Oracle / seed | attested |
| Pipeline | minted (best-effort after submit; never blocks `awaitTx`) |
| Accept-burn | burned |

```bash
curl -s http://127.0.0.1:8787/api/deposit-registry/6
```

On-chain one-shot uniqueness is **not** fully wired; design + Aiken scaffold: [ops/on-chain-deposit-registry.md](./ops/on-chain-deposit-registry.md).

---

## 13. Environment cheat sheet

### Lab desks (typical)

```bash
export PGHOST=localhost PGPORT=55432 PGUSER=bank PGPASSWORD=bank PGDATABASE=bank_sim
export CDT_ALLOW_OPEN_API=1
export ALLOW_EPHEMERAL_PAYMENT_ORACLE=1
export BURN_VALIDATE_MODE=off
export SETTLEMENT_RAIL=mock
export HOST=127.0.0.1
```

### Pilot-shaped (non-lab)

See [production-readiness.md](./production-readiness.md) §2. Highlights:

- `NODE_ENV=production`, real `PGPASSWORD`, no open API / accept-all / ephemeral oracle
- Dual or single API keys and/or JWT
- Settlement + oracle PEMs; dual-control optional
- `BURN_VALIDATE_MODE=strict` + Koios when on public stacks
- `SETTLEMENT_RAIL=http` only with real ACH URL
- Identus HTTP + TLS pins when leaving mock identity

---

## 14. Schema and fixture discipline

After DDL changes (`presentment_events`, `deposit_registry`, `idempotency_key`, attestation columns):

```bash
cd bank-sim && docker compose down -v && docker compose up -d --wait
npm run db:apply && npm run seed
# Also recreate webapp/pipeline test compose volumes if those packages fail e2e
```

Keep package fixtures aligned with `bank-sim/schema.sql`.

---

## 15. Troubleshooting

| Symptom | Likely fix |
| --- | --- |
| Vite page blank on `127.0.0.1:5173` | Use `http://localhost:5173/` |
| New API route 404 | Restart `webapp` `npm run dev` |
| Presentment create 422 “Identity verification failed” | Set checks / turn off `CDT_IDV_REQUIRE` in lab |
| Accept-burn fails with burn validation | Lab: `BURN_VALIDATE_MODE=off`; pilot: real burn tx + strict Koios |
| SettlementAuth “expired” under lab clocks | App uses request `now()` path — see settlement-auth clock notes |
| Pipeline e2e no vault UTxO | Registry mint write-back must not throw before `awaitTx` |
| `npm ci` missing vitest | Use `npm ci --include=dev` |
| Nested `file:` prepare fails | Soft-prepare scripts — do not reintroduce bare `tsc` prepare |
| Docker “container ID already exists” | `docker rm -f <name>` then compose up |
| Double presentment 409 | Expected — one open presentment per claim |
| Walk-in rejected | Name must match seeded holder |

---

## 16. “Show me the demo” checklist

1. `bank-sim` up + seed  
2. `webapp` lab env + `npm run dev`  
3. CLI: `cd offchain/demo && npm run demo`  
4. Browser: `#/open` (issuer), `#/present` with claim **6** / Satoshi, `#/pay`  
5. Optional: `npm run smoke:settlement`  

Do **not** treat docs alone as a demo.

---

## 17. What is still open before real member funds

| Gap | Notes |
| --- | --- |
| Live Identus agent | Path map ready; needs org deploy |
| Real ACH / FedNow | HTTP adapter ready; bank middleware required |
| Production CIP/IDV vendor | `CDT_IDV_URL` ready |
| On-chain mint co-spend registry | Scaffold only |
| Hired SC audit | Brief: [ops/sc-audit-brief.md](./ops/sc-audit-brief.md) |
| Native PKCS#11 | Prefer remote HSM sidecar |
| Transport mTLS at edge | Outbound client mTLS exists; terminate inbound TLS at proxy |

Authoritative matrix: [production-readiness.md](./production-readiness.md).

---

## 18. Package test matrix (CI)

```bash
# On-chain
cd onchain && aiken check

# Node packages (each: npm ci --include=dev && npm test)
# bank-sim, credentials, webapp,
# offchain/{cdt-txlib,demo,oracle-watcher,pipeline,testnet}
```

Markdown docs gate:

```bash
config=/tmp/ci.markdownlint.jsonc
printf '%s\n' '{' '  "default": true,' '  "MD013": false,' '  "MD033": false,' '  "MD041": false,' '  "MD060": false' '}' > "$config"
npx --yes markdownlint-cli2@0.23.0 --config "$config" "README.md" "docs/**/*.md"
```

---

## 19. Document ownership

| Kind | Prefer |
| --- | --- |
| How to run / demo / ops | **This manual** |
| Product thesis | whitepaper |
| Legal multi-CU | `docs/network/` |
| Security findings | security-audit |
| Pilot checklist | production-readiness |
| Day-to-day code map for agents | skill `cdt-development` (not shipped in git) |

When behavior changes, update **this manual** and **production-readiness** in the same PR as code.
