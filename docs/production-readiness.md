# Production readiness checklist

**Status:** Working prototype → production *path* (not production-certified)  
**Date:** July 2026  
**Related:** [security-audit.md](./security-audit.md) · [network/05-messaging-protocol.md](./network/05-messaging-protocol.md) · [compliance.md](./compliance.md)

This document tracks what moved from “demo-only” toward a deployable pilot, and what remains for a production CU program.

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
| **Hyperledger Identus / did:prism** | Replace mock DID/VC | **Skeleton:** `credentials/src/identus.ts` (`IDENTUS_MODE=mock\|http`) |
| **On-chain burn validation** | Prove burn tx burns deposit CDT | **Done (Koios):** `BURN_VALIDATE_MODE=strict` + `CHAIN_PROVIDER=koios-preview`; optional `CDT_POLICY_ID` |
| **ACH/FedNow integration** | SettlementPayment is an audit record | **Mock rail:** `SETTLEMENT_RAIL=mock\|log\|none` (`settlement-rail.ts`) |
| **Oracle VC path** | Fail-closed / accept-all | **credentials mode** enrolls bank DIDs via `@cdt/credentials` (`BankCredentialDirectory`) |
| **mTLS / institutional JWT** | Spec inter-CU auth | Open |
| **HSM / dual control** | Mint oracle and settlement keys | Open |
| **Professional SC audit** | Aiken validators + economic model | Open |
| **One-shot on-chain deposit registry** | Global uniqueness | Open |
| **IDV / CIP systems** | Desk checkboxes remain demo | Open |
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
