# Payment-check contract (`cdt.payment_check.v1`)

## Paradigm

**Freely spendable CDT.** The native asset can transfer without an oracle
co-signature. Payment terminals that want extra security **opt in** to an
oracle attestation check before accepting a CDT as consideration.

This does **not**:

- freeze, lock, or allowlist transfers on-chain
- move the insured deposit off the issuer’s core ledger
- replace vault redeem / early-withdraw

## Terminal flow

1. `GET /api/payment/oracle-pubkey` — pin the Ed25519 SPKI out-of-band  
2. `POST /api/payment/challenge` — one-time nonce  
3. `POST /api/payment/verify` with:

```json
{
  "claimRef": "4",
  "merchantId": "store-17",
  "challenge": "<from step 2>",
  "amountCents": 25000,
  "payerWallet": "addr1…"
}
```

4. If `ok: true`, verify `signedCheck.signature` over **canonical JSON**
   (sorted keys) of `signedCheck.payload` using the pinned public key.  
5. Optionally re-check via `POST /api/payment/verify-signature`.  
6. Accept the payment only while `payload.expiresAtMs` is in the future.

## Payload fields (signed)

| Field | Meaning |
| --- | --- |
| `schema` | Always `cdt.payment_check.v1` |
| `freelySpendable` | Always `true` — documents the paradigm |
| `depositId` / `transactionId` | Issuer claim identity |
| `status` | `active` \| `matured` (pending refuses) |
| `principalCents` | Face principal on the certificate |
| `ownerWallet` / `ownerDid` | Attested holder |
| `merchantId` | Terminal / merchant binding |
| `amountCents` | Optional invoice; must not exceed principal |
| `challenge` | Binds the check to a one-time request |
| `checkedAtMs` / `expiresAtMs` | Freshness window (~2 minutes) |

## Demo UI

Webapp route: **`#/pay`** (Payment terminal).

## Implementation

- `webapp/src/server/payment-oracle.ts`  
- Routes under `/api/payment/*` in `webapp/src/server/app.ts`
