# 05 — Messaging & API Protocol (Settlement Network)

**Document type:** Technical specification  
**Version:** 0.1  
**Status:** Draft for pilot implementation  
**Encoding:** JSON over HTTPS (TLS 1.2+)  
**Auth (pilot):** mTLS or signed JWT between institutions; API keys forbidden in browsers  

Related demo endpoints in the prototype webapp are **not** production multi-tenant
APIs; this spec is the target bilateral/multilateral interface.

---

## 1. Design goals

- Issuer remains source of truth for Claims.  
- Redeemer never needs write access to Issuer core.  
- Every cash-out is bound to a **SettlementAuth** and **unique burn**.  
- Messages are auditable and replay-safe (ids + TTL + one-time challenges).

## 2. Identifiers

| ID | Description |
| --- | --- |
| `institution_id` | Network-assigned CU id |
| `deposit_id` | Issuer deposit / CDT asset name (string) |
| `presentment_id` | Issuer-assigned id for a Presentment |
| `challenge` | One-time nonce for SettlementAuth binding |
| `tx_hash` | Cardano transaction id (hex) for burn |

## 3. Message catalog

### 3.1 `ClaimLookup` (Redeemer → Issuer)

```http
POST /v1/claims/lookup
```

```json
{
  "deposit_id": "4",
  "redeemer_institution_id": "cu_gulfside",
  "request_id": "uuid",
  "requested_at": "2026-07-14T18:00:00Z"
}
```

### 3.2 `ClaimResponse` (Issuer → Redeemer)

```json
{
  "request_id": "uuid",
  "found": true,
  "deposit_id": "4",
  "status": "active",
  "holder_name": "Ada Lovelace",
  "product_name": "12-Month Share Certificate",
  "principal_cents": 25000000,
  "rate_bps": 450,
  "penalty_bps": 1000,
  "start_ms": 1780000000000,
  "maturity_ms": 1810000000000,
  "cash_out_mode": "early",
  "cash_out_cents": 25120000,
  "owner_wallet": "addr1…",
  "mint_tx_hash": "…",
  "issuer_institution_id": "cu_campususa",
  "notes": []
}
```

`found: false` when unknown/closed.

### 3.3 `PresentmentRequest` (Redeemer → Issuer)

```http
POST /v1/presentments
```

```json
{
  "deposit_id": "4",
  "redeemer_institution_id": "cu_gulfside",
  "walk_in_name": "Ada Lovelace",
  "cash_out_mode": "early",
  "cash_out_cents": 25120000,
  "disbursement_method": "share_credit",
  "redeemer_settlement_account_ref": "ach_profile_7",
  "cip_completed": true,
  "ofac_cleared": true,
  "ownership_proof_type": "wallet_challenge",
  "ownership_proof_ref": "chal_abc",
  "request_id": "uuid"
}
```

### 3.4 `SettlementAuth` (Issuer → Redeemer) — **signed**

Issuer signs the payload with its **settlement signing key** (Ed25519 or JWS).

```json
{
  "presentment_id": "pres_01H…",
  "deposit_id": "4",
  "redeemer_institution_id": "cu_gulfside",
  "cash_out_cents": 25120000,
  "cash_out_mode": "early",
  "burn_required": true,
  "issued_at": "2026-07-14T18:05:00Z",
  "expires_at": "2026-07-14T20:05:00Z",
  "issuer_institution_id": "cu_campususa",
  "signature": "base64…",
  "algorithm": "Ed25519"
}
```

Redeemer **must** verify signature against pinned Issuer pubkey.

### 3.5 `BurnEvidence` (Redeemer → Issuer)

```http
POST /v1/presentments/{presentment_id}/burn-evidence
```

```json
{
  "presentment_id": "pres_01H…",
  "deposit_id": "4",
  "tx_hash": "…",
  "mode": "early_withdraw",
  "submitted_at": "2026-07-14T18:30:00Z"
}
```

Issuer validates on-chain (or via trusted indexer): burn of exactly one CDT for
`deposit_id` under Issuer policy; vault spend consistent with mode.

### 3.6 `BurnAccepted` / `BurnRejected`

```json
{ "presentment_id": "…", "status": "burn_accepted", "closed_on_core": true }
```

```json
{ "presentment_id": "…", "status": "burn_rejected", "reason_code": "TX_NOT_FOUND" }
```

### 3.7 `SettlementPayment` (Issuer → Redeemer)

```json
{
  "presentment_id": "…",
  "amount_cents": 25120000,
  "rail": "ACH",
  "trace_id": "…",
  "paid_at": "2026-07-15T14:00:00Z"
}
```

### 3.8 `Reject` (either direction)

```json
{
  "request_id": "…",
  "presentment_id": null,
  "reason_code": "OFAC_HIT",
  "message": "human readable"
}
```

## 4. Reason codes (initial set)

| Code | Meaning |
| --- | --- |
| `NOT_FOUND` | Unknown deposit_id |
| `ALREADY_CLOSED` | Certificate paid/closed |
| `PENDING_ATTESTATION` | Not yet minted/attested |
| `AMOUNT_MISMATCH` | Quote changed; re-lookup |
| `AUTH_EXPIRED` | SettlementAuth past expires_at |
| `NAME_MISMATCH` | Walk-in ≠ holder policy |
| `OFAC_HIT` | Sanctions escalation |
| `CAP_EXCEEDED` | Redeemer or issuer limit |
| `TX_NOT_FOUND` | Burn tx not seen |
| `TX_INVALID` | Burn does not match claim |
| `DOUBLE_PRESENTMENT` | Open or settled presentment exists |

## 5. Presentment state machine

```text
quoted
  → authorized          (SettlementAuth issued)
  → cash_credited       (Redeemer disbursed; optional)
  → burn_submitted
  → burn_accepted
  → settled
  → rejected | expired | cancelled
```

Terminal states: `settled`, `rejected`, `expired`, `cancelled`.

## 6. Security requirements

- TLS everywhere; pin institution keys.  
- Sign SettlementAuth; recommend sign ClaimResponse.  
- Idempotency keys on POST.  
- Rate limits per redeemer.  
- Clock skew tolerance ±2 minutes; prefer expiring auths ≤ 2 hours.  
- Log all messages immutably for audit.

## 7. Mapping to current prototype

| Spec message | Prototype today |
| --- | --- |
| ClaimLookup | `GET /api/claims/:ref` |
| PresentmentRequest | `POST /api/presentments` (status `pending_burn`; durable Postgres) |
| SettlementAuth | `POST /api/presentments/:id/authorize` → signed `cdt.settlement_auth.v1` |
| Pin issuer settlement key | `GET /api/settlement/pubkey` |
| BurnEvidence | `POST /api/presentments/:id/burn-evidence` `{ "txHash": "<64 hex>" }` |
| BurnAccepted | `POST /api/presentments/:id/accept-burn` |
| SettlementPayment | `POST /api/presentments/:id/settlement-payment` |
| Durable registry | `presentments` table (UNIQUE burn_tx_hash) |
| Payment-check | `POST /api/payment/verify` (merchant path; separate) |

Hold-until-burn is the only supported policy: unrestricted cash only after
`burn_accepted` (ops may place a hold earlier).

## 8. OpenAPI

Pilot implementation should publish OpenAPI 3.1 from this schema; not included
in v0.1 text draft.
