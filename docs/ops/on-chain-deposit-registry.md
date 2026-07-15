# On-chain one-shot deposit registry (design)

**Status:** Design + integration contract (off-chain `deposit_registry` is live; on-chain uniqueness is **not** enforced yet)  
**Related:** `bank-sim` / webapp `deposit_registry` table · mint policy trust note in `cdt_mint.ak` · [production-readiness.md](../production-readiness.md)

## Problem

The mint policy enforces **per-transaction** uniqueness of `deposit_id` as the asset name, but **not across transactions**. A compromised or buggy oracle that co-signs two mints for the same bank deposit would create two vaults / two CDTs. Off-chain UNIQUE indexes and the issuer `deposit_registry` table close this for honest issuers; a global, publicly verifiable one-shot requires an **on-chain registry**.

## Goals

1. **One mint per `deposit_id`** under a given CDT policy, forever (or until registry is sunset by governance).
2. **Publicly auditable** used-set (or commitment to that set).
3. **Minimal change** to existing vault / mint redeemer surface where possible.
4. Fail closed: if registry step missing → mint invalid.

## Non-goals

- Storing full attestation payloads on-chain (keep NPI off-ledger).
- Cross-policy global uniqueness (each issuance program has its own registry).
- Replacing the off-chain control plane (oracle still required).

## Recommended design: registry UTxO + mint co-spend

```text
┌─────────────┐     spend + append      ┌──────────────────┐
│ Registry    │ ──────────────────────► │ Registry'        │
│ UTxO        │     (same tx as mint)   │ UTxO             │
│ datum: used │                         │ datum: used∪{id} │
└─────────────┘                         └──────────────────┘
        ▲
        │ required input
        │
┌─────────────┐
│ cdt_mint    │  MintCD { datum } — still needs oracle_vkh
│ + vault out │
└─────────────┘
```

### Datum (sketch)

```text
DepositRegistryDatum {
  /// Authority that may authorize registry spends (issuer multi-sig / script)
  admin: VerificationKeyHash | ScriptHash,
  /// Used deposit_ids as ByteArray asset names (or hashes thereof)
  used: List<ByteArray>,
  /// Optional: root of a more scalable structure (trie / Merkle) for later
  commitment: ByteArray,  // empty until scaled
}
```

### Redeemer

```text
RegisterDeposit { deposit_id: ByteArray }
```

### Rules

1. Spending the registry UTxO requires `admin` signature **or** is gated so only the mint policy script can update it in the same tx (preferred: **mint policy is the only consumer** via script reference / linked validators).
2. `deposit_id` **must not** already appear in `used`.
3. Output registry datum = `used` with `deposit_id` appended (order-stable or sorted).
4. Same transaction must mint exactly `+1` of `deposit_id` under the CDT policy (link via mint field inspection).
5. Burns do **not** free the id (one-shot forever) — matches “never re-issue same deposit.”

### Scaling path

When `used` grows large:

- Switch `used` list → **Merkle set** / sparse trie with proof in redeemer.
- Or shard by `deposit_id` prefix across N registry UTxOs.

Pilot with list + size limit (e.g. pilot hundreds of CDs) is acceptable for a single CU pilot.

## Integration with off-chain control plane

| Layer | Role |
| --- | --- |
| Oracle attestation | Still required (oracle_vkh) |
| Off-chain `deposit_registry` | Fast fail + ops UI (`attested→minted→burned`) |
| On-chain registry | Cryptographic uniqueness under adversarial oracle |

Pipeline mint flow becomes:

1. `registryAssertMintable` (DB)  
2. Build tx: spend registry + mint + vault  
3. Oracle co-sign  
4. Submit → write `minted` off-chain  

## Security notes

- **Admin key compromise** could still corrupt the registry; use multi-sig / dual control for admin.
- **Do not** put member PII in the registry datum — only `deposit_id` bytes (already on-chain as asset name).
- Registry UTxO is a **concurrency hotspot** (one write at a time). Acceptable for low-frequency CD minting; use batching or shards if needed.

## Implementation status in this monorepo

| Piece | Status |
| --- | --- |
| Off-chain table + APIs | **Done** |
| Design (this doc) | **Done** |
| Aiken `deposit_registry` validator | **Scaffold** — see `onchain/validators/deposit_registry.ak` (documented stub; not linked into production mint yet) |
| Pipeline co-spend | Open |
| Mainnet deployment of registry UTxO | Open |

## Acceptance criteria (when “done”)

1. Aiken property tests: second mint with same `deposit_id` fails.  
2. Pipeline e2e: double mint attempt rejected on-chain even if DB UNIQUE bypassed.  
3. `docs/security-audit.md` updated: H-5 closed for on-chain uniqueness.  
4. Blueprint hash pinned in mint parameters alongside oracle/vault.
