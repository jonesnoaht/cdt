# Pilot key ceremony & dual control

**Audience:** ops / security officers preparing a pilot CU network  
**Status:** software PEMs + custody process (HSM wire-up still open)  
**Related:** [production-readiness.md](../production-readiness.md) · [security-audit.md](../security-audit.md)

## 1. Goals

1. Generate **distinct** Ed25519 keys for:
   - mint oracle (`ORACLE_SIGNING_KEY_PEM`)
   - payment-check oracle (`PAYMENT_ORACLE_SIGNING_KEY_PEM`)
   - settlement auth primary (`SETTLEMENT_SIGNING_KEY_PEM`)
   - settlement secondary (custody only — dual control)
2. Pin **public SPKI** values in config / runbooks (never private PEMs in git).
3. Split **issuer** vs **correspondent** API credentials (or JWT).

## 2. Generate material

```bash
cd webapp
OUT_DIR=./keys-pilot npm run keygen:pilot
# creates keys-pilot/*.private.pem (0600) + *.spki.b64 + pilot.env.example
```

### Rules

- Run on an air-gapped or controlled admin workstation when possible.
- Two officers present: one generates, one records public SPKI hashes offline.
- Private PEMs leave the generator only via HSM import or sealed transfer — not chat/email.
- Add `keys-pilot/` and `*.private.pem` to local ignore; never commit.

## 3. Dual control (process today / software later)

| Key | Custody A | Custody B | Used by |
| --- | --- | --- | --- |
| Mint oracle | Ops A | backup offline | oracle-watcher / pipeline |
| Payment oracle | Merchant ops | backup | webapp payment-check |
| Settlement primary | Issuer desk | — | `SettlementSigner` |
| Settlement secondary | Board/sec officer offline | — | future cosign; not live in software path |

**Process dual control for SettlementAuth (pilot):**

1. Issuer desk operator A requests authorize in the portal/API.
2. Second officer B confirms presentment id + amount offline (ticket / 4-eyes).
3. Only after B’s check does A call `POST …/authorize`.
4. Audit: `presentment_events` + desk ticket id in `detail` (attach ticket id in ops notes).

Future software cosign can require a second signature over the same canonical payload using `settlement-secondary`.

## 4. Runtime env (issuer node)

```bash
export NODE_ENV=production
export HOST=127.0.0.1
export PGPASSWORD='…'
export CDT_ISSUER_API_KEY='…'
export CDT_CORRESPONDENT_API_KEY='…'   # or share only via JWT mint
export CDT_JWT_SECRET='…'             # ≥32 bytes
export ORACLE_SIGNING_KEY_PEM='…'
export PAYMENT_ORACLE_SIGNING_KEY_PEM='…'
export SETTLEMENT_SIGNING_KEY_PEM='…'
export MINT_ORACLE_PUBKEY_SPKI='…'    # pin for GET /api/attestations
export CDT_VC_MODE=credentials
export BURN_VALIDATE_MODE=strict
export CHAIN_PROVIDER=koios-preview
# never: CDT_ALLOW_OPEN_API, CDT_ORACLE_ACCEPT_ALL_VC, ALLOW_EPHEMERAL_*
```

Validate:

```bash
cd webapp && NODE_ENV=production npm run check:prod-env
```

## 5. Rotation

1. Generate new key pair; publish new SPKI to counterparties with effective date.
2. Dual-run: accept old + new verify windows during TTL overlap (SettlementAuth TTL is 2h).
3. Retire old private material; shred offline backups after grace period.
4. Record ceremony log: date, officers, SPKI fingerprints, systems updated.

## 6. Deposit registry (one-shot off-chain)

Issuer Postgres table `deposit_registry` tracks `attested → minted → burned` per `deposit_id`.

- **Oracle watcher** writes `attested` on each new attestation.
- **Pipeline mint** asserts not burned, then writes `minted` + `mint_tx_hash` on submit/reconcile.
- **Burn accept** (webapp) writes `burned` + unique `burn_tx_hash`.
- Prevents re-use of the same burn/mint tx or re-mint after burn at the issuer DB.
- **Not** a substitute for a global on-chain one-shot mint registry; it is the pilot control plane.

Query: `GET /api/deposit-registry/:depositId`

## 7. Signing providers (oracle)

| Provider | Env | Status |
| --- | --- | --- |
| `pem` (default) | `ORACLE_SIGNING_KEY_PEM` | Production software path |
| `ephemeral` | `ALLOW_EPHEMERAL_ORACLE_KEY=1` | Lab only |
| `remote` | `ORACLE_SIGNING_PROVIDER=remote` + `ORACLE_REMOTE_SIGNER_URL` (+ optional token/pubkey pin) | **HSM sidecar / enclave bridge** (lab: `scripts/remote-signer-lab.ts`) |
| `hsm` | `ORACLE_SIGNING_PROVIDER=hsm` + `ORACLE_HSM_MODULE` + `ORACLE_HSM_KEY_ID` | **Stub** — fails closed until PKCS#11 native module |

### Dual-control SettlementAuth

```bash
export SETTLEMENT_SIGNING_KEY_PEM=…           # primary desk
export SETTLEMENT_SECONDARY_SIGNING_KEY_PEM=… # officer B (from key ceremony secondary)
export SETTLEMENT_DUAL_CONTROL=1
```

`issue()` attaches both Ed25519 signatures over the same canonical payload;
`verify()` rejects missing or wrong secondary cosign when dual control is on.

## 8. Settlement idempotency

Clients should send:

```http
Idempotency-Key: <uuid>
POST /api/presentments/:id/settlement-payment
```

Retries with the same key return the same settled presentment; colliding keys on different ids → 409.
