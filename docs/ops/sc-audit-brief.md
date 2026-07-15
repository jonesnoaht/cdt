# Smart-contract audit brief (CDT)

**Status:** Pre-audit package for external reviewers (not an audit report)  
**Code freeze target:** pin `onchain/plutus.json` + git tag before engagement  
**Related:** [security-audit.md](../security-audit.md) · [architecture.md](../architecture.md) · [on-chain-deposit-registry.md](./on-chain-deposit-registry.md)

## 1. Scope

### In scope

| Artifact | Path | Role |
| --- | --- | --- |
| CD vault spend validator | `onchain/validators/cd_vault.ak` | Locks principal+interest; Redeem / EarlyWithdraw |
| CDT mint policy | `onchain/validators/cdt_mint.ak` | Oracle co-sign mint; permissionless burn of asset |
| Interest math | `onchain/lib/cdt/interest.ak` | Mature / early payout (must match off-chain `cdt-txlib`) |
| Types / fixtures | `onchain/lib/cdt/types.ak`, `fixtures.ak` | Datum/redeemer shape |
| Off-chain builders | `offchain/cdt-txlib/` | Must not weaken on-chain assumptions |

### Out of scope (document only)

- Bank core, ACH middleware, Identus cloud  
- Webapp API auth (covered by app sec review)  
- Oracle key custody (ops / HSM) — assume oracle can be malicious for uniqueness analysis  

## 2. Trust model

```
Member wallet ──signs──► Redeem / EarlyWithdraw (vault)
Oracle VKH    ──co-signs► MintCD only
Issuer desk   ──off-chain► SettlementAuth (not on-chain)
Public        ──verifies► Ledger state + attestation hash pin
```

**Oracle is trusted for truth of deposit terms** but must be analyzed for **double-attest** risk (see registry design). Vault trusts **datum equality** and owner/time rules, not the oracle signature at redeem time.

## 3. Assets & economic invariants

1. Mint creates exactly one token named `deposit_id` and a vault locking ≥ mature payout lovelace with matching inline datum.  
2. Vault spend requires burning the CDT in the same transaction.  
3. Mature redeem pays principal + interest to owner path.  
4. Early withdraw applies `penalty_bps` on-chain.  
5. Burning CDT without vault spend strands funds (documented self-harm; not a protocol bug — confirm wording with counsel).

## 4. Known residual risks (must brief auditor)

| ID | Risk | Mitigation today | Desired |
| --- | --- | --- | --- |
| H-5 | Double mint same deposit_id | Off-chain UNIQUE + deposit_registry | On-chain registry |
| Oracle | Malicious terms | Operational dual control | Legal + monitoring |
| Tooling | Aiken/stdlib churn | Pin compiler in aiken.toml | Long-term support contract |
| Interest | Off-chain/on-chain drift | Shared constants tests | Formal equality proof |

## 5. Test evidence for auditors

```bash
cd onchain && aiken check
cd offchain/cdt-txlib && npm ci --include=dev && npm test
cd offchain/pipeline && npm ci --include=dev && npm test
cd offchain/demo && npm ci --include=dev && npm test && npm run demo
```

Provide:

- `plutus.json` blueprint hashes  
- Property / unit tests for interest edge cases (0 term, max penalty, maturity boundary)  
- Emulator e2e logs for mint → mature redeem and early withdraw  

## 6. Redeemer / datum surface (review checklist)

- [ ] All `CDDatum` fields covered by attestation_hash off-chain  
- [ ] `account_id` non-empty at mint  
- [ ] Time validity intervals for early vs mature  
- [ ] No extra mint under policy  
- [ ] Vault script hash parameter binding  

## 7. Suggested engagement shape

1. **Phase A (1–2 weeks):** design review + threat model workshop  
2. **Phase B:** formal review of Aiken validators + interest  
3. **Phase C:** differential review of `cdt-txlib` builders vs validators  
4. **Deliverable:** findings ranked Critical/High/Med/Low + fix verification  

## 8. Contacts & freeze process

1. Tag release candidate: `git tag sc-audit-rc1 && git push --tags`  
2. Export `onchain/plutus.json` and commit hash  
3. Freeze on-chain directory except agreed fixes  
4. Re-run full test matrix after each finding fix  

## 9. Out of band documents for auditor

- `docs/whitepaper.md` — product intent  
- `docs/network/05-messaging-protocol.md` — burn-and-settle (off-chain)  
- `docs/compliance.md` — CIP/BSA framing  
- This brief + security-audit remediation table  
