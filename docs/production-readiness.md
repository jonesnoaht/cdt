# Production readiness checklist

**Status:** Working prototype → production *path* (not production-certified)  
**Date:** July 2026  
**Related:** [Operator manual](./manual.md) · [security-audit.md](./security-audit.md) · [network/05-messaging-protocol.md](./network/05-messaging-protocol.md) · [compliance.md](./compliance.md) · [docs index](./README.md)

This document tracks what moved from “demo-only” toward a deployable pilot, and what remains for a production CU program. For day-to-day runbooks and desk flows, prefer the **[operator manual](./manual.md)**.

---

## 1. What is production-shaped now

| Area | Capability |
| --- | --- |
| **Issuance linkage** | Vault `account_id` + 32-byte `attestation_hash`; oracle `cdt.attestation.v2`; DB UNIQUE deposit/hash; `GET /api/attestations/:id` |
| **VC gate** | Default **fail-closed**; lab `accept_all`; **`credentials` mode** via `@cdt/credentials` + presentation directory (`CDT_VC_MODE`) |
| **API surface** | API key auth, rate limits, security headers, bind `127.0.0.1` by default |
| **Correspondent settlement** | Durable `presentments` table + state machine: `pending_burn` → `authorized` (SettlementAuth) → `burn_submitted` → `burn_accepted` → `settled` |
| **SettlementAuth** | Ed25519 signed `cdt.settlement_auth.v1`, `burn_required: true`, TTL; `GET /api/settlement/pubkey` |
| **BurnEvidence** | Unique `burn_tx_hash` guard; accept-burn + SettlementPayment endpoints |
| **Payment check** | Required `payerWallet` match; optional stable PEM |
| **Keys** | No private PEM logging; env PEMs for oracle / payment / settlement |

### Settlement network APIs (issuer side)

| Step | Method |
| --- | --- |
| Claim lookup | `GET /api/claims/:ref` |
| Presentment | `POST /api/presentments` |
| SettlementAuth | `POST /api/presentments/:id/authorize` |
| BurnEvidence | `POST /api/presentments/:id/burn-evidence` `{ "txHash": "<64 hex>" }` |
| BurnAccepted | `POST /api/presentments/:id/accept-burn` |
| SettlementPayment | `POST /api/presentments/:id/settlement-payment` `{ amountCents, rail, traceId }` |
| Pin settlement key | `GET /api/settlement/pubkey` |

Hold-until-burn is the only supported cash policy for production-shaped desks.

---

## 2. Environment (pilot host)

```bash
# Required for non-lab
export NODE_ENV=production
export CDT_API_KEY='…'
export PGPASSWORD='…'          # no default in production
export ORACLE_SIGNING_KEY_PEM='…'
export PAYMENT_ORACLE_SIGNING_KEY_PEM='…'
export SETTLEMENT_SIGNING_KEY_PEM='…'   # optional; else ephemeral lab key
export CDT_ISSUER_API_KEY='…'          # authorize / accept-burn / settlement-payment
export CDT_CORRESPONDENT_API_KEY='…'   # presentments / burn-evidence
# or single shared key:
# export CDT_API_KEY='…'
export CDT_JWT_SECRET='…'             # ≥32 random bytes; POST /api/auth/token mints role JWTs
export SETTLEMENT_RAIL=http
export SETTLEMENT_ACH_URL=https://ach-adapter.internal/v1/credit
export SETTLEMENT_ACH_TOKEN=…            # optional Bearer
# lab: SETTLEMENT_RAIL=mock
export CDT_TLS_CERT_FILE=/etc/cdt/client.crt
export CDT_TLS_KEY_FILE=/etc/cdt/client.key
export CDT_TLS_CA_FILE=/etc/cdt/ca.crt
# never in production: CDT_TLS_REJECT_UNAUTHORIZED=0
export HOST=127.0.0.1
export CDT_VC_MODE=credentials
export CDT_TRUSTED_ROOT_DID='did:…'
export CDT_PRESENTATION_DIR=/var/cdt/presentations
export CHAIN_PROVIDER=koios-preview
export BURN_VALIDATE_MODE=strict
export CDT_POLICY_ID='…'                 # optional
export IDENTUS_MODE=mock                 # until Identus HTTP agent is wired

# Forbidden in production
# CDT_ORACLE_ACCEPT_ALL_VC=1
# CDT_ALLOW_OPEN_API=1
# ALLOW_EPHEMERAL_ORACLE_KEY=1
# BURN_VALIDATE_MODE=off
```

Terminate TLS at a reverse proxy; never expose Postgres or the API on a public interface without mTLS/JWT between institutions.

---

## 3. Still required before real member funds

| Gap | Why | Status |
| --- | --- | --- |
| **Hyperledger Identus / did:prism** | Replace mock DID/VC | **HTTP client + path map + mTLS:** `IDENTUS_PATH_*`, `docs/ops/identus-path-mapping.md`, `CDT_TLS_*` |
| **Settlement audit** | Immutable transition log | **Done:** `presentment_events` + `GET /api/presentments/:id/events` |
| **SettlementAuth binding** | Auth must match claim + stay valid | **Done:** deposit_id match + signature/TTL re-check on burn + accept |
| **On-chain burn validation** | Prove burn tx burns deposit CDT | **Done (Koios):** negative mint qty **exactly -1** for deposit asset; optional policy pin |
| **ACH/FedNow integration** | SettlementPayment is an audit record | **HTTP + optional mTLS:** `SETTLEMENT_RAIL=http` + `SETTLEMENT_ACH_URL` + `CDT_TLS_*` |
| **mTLS / institutional JWT** | Spec inter-CU auth | **JWT/keys done** + **outbound mTLS** via `CDT_TLS_CERT/KEY/CA_FILE` for ACH/IDV/Identus |
| **Oracle VC path** | Fail-closed / accept-all | **credentials mode** + Identus HTTP path map |
| **HSM / dual control** | Mint oracle and settlement keys | **Dual-control SettlementAuth cosign** (`SETTLEMENT_DUAL_CONTROL`); oracle **remote signer** (`ORACLE_SIGNING_PROVIDER=remote`) + PKCS#11 stub |
| **Professional SC audit** | Aiken validators + economic model | **Pre-audit package:** `docs/ops/sc-audit-brief.md` (engagement not executed) |
| **One-shot on-chain deposit registry** | Global uniqueness | **Off-chain done** + **design + Aiken scaffold** (`docs/ops/on-chain-deposit-registry.md`, `deposit_registry.ak`); mint co-spend open |
| **Key ceremony / dual control** | Ops process + PEMs | **Done:** `docs/ops/key-ceremony.md` + `npm run keygen:pilot` |
| **Settlement idempotency** | Safe retries | **Done:** `Idempotency-Key` on settlement-payment |
| **Mobile wallet sign / QR** | Member signs redeem/burn on phone | **Done:** sign-requests + `#/sign` + wallet deep-link catalog |
| **IDV / CIP systems** | Desk checkboxes remain demo | **Adapter:** `CDT_IDV_MODE=mock\|http`, `POST /api/idv/check`, optional `CDT_IDV_REQUIRE=1` on presentments |
| **OpenAPI** | Machine-readable settlement API | **Done:** `docs/openapi/settlement-v1.yaml`, `GET /api/openapi.json` |

---

## 2b. Burn validation env

```bash
export CHAIN_PROVIDER=koios-preview
export KOIOS_BASE_URL=https://preview.koios.rest/api/v1   # or mainnet Koios
export BURN_VALIDATE_MODE=strict   # off | soft | strict (default strict when provider set)
export CDT_POLICY_ID=…             # optional hex policy id for exact asset match
```

`POST /api/presentments/:id/accept-burn` calls Koios `tx_info` and requires a
**negative mint quantity** for the deposit's asset name (UTF-8 → hex). Soft mode
records warnings but still accepts; off skips the network (lab tests).

---

## 4. Bootstrap path (recommended)

1. **Phase 0** — Paper MOU + manual burn + wire (already documented under `docs/network/`).  
2. **Phase 1 (this codebase)** — Bilateral APIs on private network: SettlementAuth + BurnEvidence + durable presentments + fail-closed VC + account-bound mint.  
3. **Phase 2** — Identus, real burn indexer check, ACH adapter, multi-CU master agreement.  
4. **Phase 3** — Hub/CUSO, formal audits, mainnet keys.

---

## 5. Verification commands (lab)

```bash
# Schemas + units
cd onchain && aiken check
cd offchain/cdt-txlib && npm test
cd offchain/oracle-watcher && npm test
cd webapp && npm test && npm run typecheck
cd offchain/demo && npm test
cd offchain/testnet && npm run typecheck
```

Do **not** treat green tests as permission to take insured deposits onto a public stack.
