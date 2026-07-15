# CDT Security Audit — Working Prototype

**Date:** July 2026  
**Updated:** July 2026 (remediation wave)  
**Auditor:** Hermes Agent (repository review)  
**Scope:** Code and configuration present in this repository as of the audit  
**Status:** Prototype — critical/high items addressed in code; not production-certified  
**Related:** [compliance.md](./compliance.md) · [architecture.md](./architecture.md) · [whitepaper.md](./whitepaper.md) · [network risk memo](./network/09-risk-and-compliance-memo.md)

---

## Remediation status (2026-07)

| ID | Finding | Status |
| --- | --- | --- |
| **Issuance linkage** | Every mint bound to attested account | **Fixed:** `CDDatum.account_id` + `attestation_hash` (32-byte SHA-256); mint policy enforces non-empty account_id and hash length 32; oracle payload `cdt.attestation.v2` includes `account_id` + `owner_did`; DB UNIQUE on `deposit_id` / hash; `GET /api/attestations/:depositId` for public verification instructions |
| C-1 | Oracle accept-all VC | **Fixed:** fail-closed unless `CDT_ORACLE_ACCEPT_ALL_VC=1`; no private key logging; require `ORACLE_SIGNING_KEY_PEM` unless `ALLOW_EPHEMERAL_ORACLE_KEY=1` |
| C-2 | Unauthenticated API | **Fixed:** API key middleware (`CDT_API_KEY`); open lab only via `CDT_ALLOW_OPEN_API=1` / `allowOpenApi` |
| H-1 | Default DB password | **Mitigated:** no default password when `NODE_ENV=production` |
| H-2 | Ephemeral keys / log PEM | **Fixed:** no private key print; payment oracle stable PEM env; host bind `127.0.0.1` |
| H-3 | Cash without burn | **Fixed:** presentment status `pending_burn`; desk instructions hold-until-burn |
| H-4 | Checkbox CIP | **Partial:** still demo checkboxes (no IDV vendor); API requires all flags true |
| H-5 | Double mint uniqueness | **Mitigated off-chain:** UNIQUE `deposit_id` + unique attestation hash; on-chain still requires honest oracle across txs (documented) |
| M-1 | PII leak | **Partial:** attestation endpoint returns linkage fields only |
| M-2 | Rate limits | **Fixed:** 300 req/min per client key |
| M-3 | In-memory presentments | **Open** (demo) |
| M-4 | Payment possession | **Mitigated:** `payerWallet` **required** and must match owner |
| L-2 | Security headers | **Fixed:** CSP, nosniff, frame deny, no-store |

Remaining production work: Identus wire-up, HSM keys, durable presentment table, professional SC audit, on-chain one-shot deposit_id registry.

---

> **Disclaimer.** This is a structured engineering security review of an open
> prototype, not a formal penetration test, smart-contract audit firm report,
> or legal opinion. Findings prioritize **realistic abuse of what is built
> today** if the demo were exposed beyond a trusted lab.

---

## 1. Executive summary

| Area | Verdict for **local demo** | Verdict for **production** |
| --- | --- | --- |
| On-chain vault/mint design | Reasonable for stated model | Needs professional audit + mainnet discipline |
| Credential verification library | Solid demo crypto hygiene | Needs Identus, revocation, production keys |
| Oracle watcher CLI | **Unsafe if mistaken for prod** | Must never use accept-all VC mode |
| Webapp + bank-sim APIs | Fine on localhost | **Do not expose** without redesign |
| Payment-check oracle | Useful opt-in pattern | Ephemeral keys, no auth, privacy issues |
| Correspondent presentment | UI/process demo only | Checkboxes ≠ CIP; no real settlement auth |

**Headline risks if the stack were internet-facing as-is:**

1. **Unauthenticated full API** → anyone can read members, open CDs, file
   presentments, mint-adjacent workflows against the core sim.  
2. **Oracle demo mode accepts all VCs** → fraudulent mint attestations.  
3. **Default credentials** (`bank`/`bank`, open Postgres port).  
4. **Freely transferable CDT + cash presentment without enforced burn** →
   economic double-spend if operators trust the demo presentment desk.  
5. **Payment-oracle keys reset every process** → terminals cannot safely pin a
   long-lived key without ops process.

**Positive findings:** parameterized SQL in reviewed paths; vault
anti-double-satisfaction and burn-coupled redeem; mint requires oracle vkh;
VC presentation requires non-empty challenge; payment checks use challenge
consume + short TTL + Ed25519 over canonical JSON; secrets not hardcoded as
long-lived production keys in source (demo defaults are explicit).

---

## 2. Scope & method

### In scope

| Component | Paths |
| --- | --- |
| On-chain validators | `onchain/validators/cd_vault.ak`, `cdt_mint.ak` |
| Credentials | `credentials/src/*` |
| Oracle watcher | `offchain/oracle-watcher/src/*` |
| Bank simulator | `bank-sim/*` |
| Webapp API + UI | `webapp/src/server/*`, `webapp/src/ui/*` |
| Payment oracle | `webapp/src/server/payment-oracle.ts` |
| Presentments | `webapp/src/server/presentments.ts` |
| Config / defaults | `webapp/src/server/config.ts`, docker-compose files |

### Out of scope / limited

- Full formal verification of Plutus cost/size  
- Dependency CVE inventory (npm audit not run in this pass)  
- Live network penetration  
- Production Identus deployment  
- Cardano node / wallet OS security  

### Method

Static review of validators and TypeScript services; configuration defaults;
trust-boundary analysis for mint, free transfer, presentment, and payment-check;
cross-check with documented threat model in architecture/compliance.

---

## 3. Trust model (what the system *claims*)

| Fact | Trusted party |
| --- | --- |
| CIP completed | Issuing CU (off-chain) |
| Deposit exists / unique | Core DB + honest oracle |
| Mint allowed | Oracle key co-sign on-chain |
| Redeem math | Vault script |
| Free transfer of CDT | Anyone with the asset (by design) |
| Payment acceptance safety | Terminal that verifies payment-check |
| Correspondent cash advance | Redeeming CU process + issuer settlement |

**Anything that confuses “demo API says ok” with “insured claim paid once” is a
security failure in operations, even if scripts are correct.**

---

## 4. Findings

Severity scale: **Critical** · **High** · **Medium** · **Low** · **Info**

---

### C-1 · Oracle CLI accepts all VC presentations (demo mode)

| | |
| --- | --- |
| **Severity** | **Critical** (if CLI used outside lab) |
| **Component** | `offchain/oracle-watcher/src/cli.ts` |
| **Issue** | `verifyPresentation` always returns `{ verified: true }` and logs a warning. Any observed CD funding deposit can be attested and minted without real credentials. |
| **Impact** | Fraudulent CDTs / vault funding against fake identity. |
| **Status** | Documented as demo; still dangerous if ops copy-paste. |
| **Remediation** | Fail closed unless `VERIFY_PRESENTATION_URL` / Identus hook configured; refuse to start without `ORACLE_SIGNING_KEY_PEM` in non-demo profile; CI check that prod entrypoints do not import accept-all. |

---

### C-2 · Unauthenticated webapp API is a full bank-sim control plane

| | |
| --- | --- |
| **Severity** | **Critical** (if bound to non-localhost) |
| **Component** | `webapp/src/server/app.ts`, `main.ts` |
| **Issue** | No authentication, authorization, CSRF protection, or tenant isolation. Endpoints allow listing members, opening deposits, looking up any claim by sequential id, filing presentments, and obtaining payment checks. |
| **Impact** | Complete integrity and confidentiality failure of the simulated core; in a real integration this would be catastrophic. |
| **Remediation** | mTLS or OAuth2 for institution APIs; session auth for member UI; RBAC (teller vs member vs merchant); bind `127.0.0.1` by default; reverse-proxy auth in any shared environment. |

---

### H-1 · Default database credentials and exposed port

| | |
| --- | --- |
| **Severity** | **High** |
| **Component** | `bank-sim/docker-compose.yml`, `webapp/src/server/config.ts` |
| **Issue** | Defaults `user/password = bank/bank`, host port **55432** published. |
| **Impact** | Trivial unauthorized core access on shared networks. |
| **Remediation** | Strong secrets via env; do not publish DB ports in non-dev compose; network isolation. |

---

### H-2 · Ephemeral oracle / payment-oracle keys

| | |
| --- | --- |
| **Severity** | **High** (ops integrity) |
| **Component** | `oracle-watcher` CLI; `PaymentOracle` constructor |
| **Issue** | Missing PEM → generate ephemeral key. CLI may **print private key PEM to logs**. Payment oracle regenerates key every process restart; terminals that pin pubkey from `/api/payment/oracle-pubkey` see key rotation without ceremony. |
| **Impact** | Mint policy `oracle_vkh` mismatch after restart; payment-check signatures unverifiable; private key leakage via logs. |
| **Remediation** | Require `ORACLE_SIGNING_KEY_PEM` / `PAYMENT_ORACLE_SIGNING_KEY_PEM`; never log private keys; HSM/KMS; versioned key directory with pin. |

---

### H-3 · Free-spend CDT vs presentment cash advance (economic double-spend)

| | |
| --- | --- |
| **Severity** | **High** (product/security interaction) |
| **Component** | On-chain free native asset + `PresentmentStore` + desk UI |
| **Issue** | CDT can still transfer after a demo “cash advanced” presentment. Presentment does **not** lock or burn the token. Double-cash is only blocked in **in-memory** presentment map for that API process. |
| **Impact** | If operators treat presentment as final cash-out, attacker gets cash + still spends CDT elsewhere. |
| **Remediation** | Enforce burn-before-finality (or hold) per network ops docs; SettlementAuth + BurnEvidence; on-chain optional freeze only if product requires (conflicts with free-spend paradigm—then finality must be operational). |

---

### H-4 · CIP / OFAC / ownership are self-attested checkboxes

| | |
| --- | --- |
| **Severity** | **High** (compliance control failure) |
| **Component** | Presentment API + OpenCd tokenize checklist |
| **Issue** | Server only checks booleans in JSON; no integration with OFAC lists, IDV, or wallet challenge cryptography. Walk-in name match is case-insensitive string equality only. |
| **Impact** | False sense of control; fails any real BSA examination if marketed as control. |
| **Remediation** | Integrate IDV/OFAC providers; server-side wallet challenge (sign nonce with payment key); audit log with officer identity (auth required). |

---

### H-5 · Cross-deposit mint uniqueness is off-chain only

| | |
| --- | --- |
| **Severity** | **High** (trust assumption) |
| **Component** | `cdt_mint` + oracle + `attestations UNIQUE(transaction_id)` |
| **Issue** | Policy enforces **one mint shape per tx**, not global uniqueness of `deposit_id` across time. A compromised or buggy oracle can co-sign a second mint for the same deposit_id if DB constraints are bypassed or a second oracle key is used. |
| **Impact** | Duplicate receipts against one core deposit. |
| **Remediation** | Hard DB uniqueness + single oracle key ceremony; optional one-shot state thread / reference input pattern on-chain for deposit_id; monitoring for duplicate asset names. |

---

### M-1 · Sensitive data exposure via claim / payment APIs

| | |
| --- | --- |
| **Severity** | **Medium** |
| **Component** | `GET /api/claims/:ref`, payment verify payload |
| **Issue** | Returns holder **name**, **DID**, **wallet**, principal, product—guessable sequential ids (`4`,`5`,`6`). |
| **Impact** | Privacy (GLBA-relevant if real NPI); target enumeration for social engineering. |
| **Remediation** | AuthZ; non-sequential deposit ids; minimize fields; merchant verify returns only need-to-know. |

---

### M-2 · No rate limiting / challenge flooding

| | |
| --- | --- |
| **Severity** | **Medium** |
| **Component** | Payment challenge map; all POST endpoints |
| **Issue** | Unbounded challenge issuance; in-memory `Map` growth until GC of expired; deposit spam on bank-sim. |
| **Impact** | Memory DoS; noise; resource exhaustion. |
| **Remediation** | Rate limits per IP/merchant; cap map size; WAF. |

---

### M-3 · Presentment store not durable or multi-instance safe

| | |
| --- | --- |
| **Severity** | **Medium** |
| **Component** | `PresentmentStore` in-process memory |
| **Issue** | Restart clears double-cash protection; two API replicas diverge. |
| **Impact** | Double presentment under scale-out. |
| **Remediation** | Postgres presentments table with unique open claim constraint. |

---

### M-4 · Payment-check does not prove possession of CDT

| | |
| --- | --- |
| **Severity** | **Medium** |
| **Component** | `PaymentOracle.verify` |
| **Issue** | Verifies issuer attestation + optional wallet string match; does not require on-chain UTxO ownership proof or signature from the asset holder at verify time. |
| **Impact** | Attacker who learns `deposit_id` may obtain a signed check without controlling the token (social engineering the terminal). |
| **Remediation** | Require CIP-30/wallet signature over challenge proving control of `owner` payment key; optional UTxO presence check. |

---

### M-5 · `BurnCD` policy allows anyone to burn (if they hold tokens)

| | |
| --- | --- |
| **Severity** | **Medium** (by design / griefing) |
| **Component** | `cdt_mint` `BurnCD` |
| **Issue** | Burn redeemer only requires negative mint amounts—no oracle. Correct for “holder burns,” but a thief who steals the token can burn it outside vault redeem (destroy receipt without payout) if they construct a burn-only tx. |
| **Impact** | Griefing loss of receipt; economic recovery depends on issuer off-chain process. |
| **Remediation** | Accept for free-spend assets; issuer recovery procedures; optional burn only when spending vault (harder UX). |

---

### M-6 · Principal encoded as JavaScript `number` in attestations

| | |
| --- | --- |
| **Severity** | **Medium** (scale) |
| **Component** | `buildAttestationPayload` |
| **Issue** | Throws if lovelace > `Number.MAX_SAFE_INTEGER`; large certificates unsafe in JS number path. |
| **Impact** | Incorrect terms or refusal for large notionals. |
| **Remediation** | Use `bigint` end-to-end through Lucid/Aiken boundary carefully. |

---

### M-7 · Demo USD=ADA peg

| | |
| --- | --- |
| **Severity** | **Medium** (economic) |
| **Component** | `LOVELACE_PER_CENT` |
| **Issue** | Fixed peg is not a price oracle; production mis-use would mis-fund vaults. |
| **Remediation** | Stable asset denomination or explicit FX policy with governance. |

---

### L-1 · Member “session” is only `localStorage` member id

| | |
| --- | --- |
| **Severity** | **Low** (demo UX) |
| **Component** | `webapp/src/ui/App.tsx` |
| **Issue** | Client-side selection of member id; server never verifies the caller is that member. |
| **Impact** | Combined with C-2, trivial impersonation. |
| **Remediation** | Real auth; server-side sessions. |

---

### L-2 · Static UI served from API has no CSP headers observed

| | |
| --- | --- |
| **Severity** | **Low** |
| **Component** | `main.ts` static serve |
| **Issue** | No security headers (CSP, HSTS, X-Frame-Options) in app code. |
| **Impact** | XSS blast radius if any future HTML injection. |
| **Remediation** | Helmet-equivalent middleware; CSP. |

---

### L-3 · Koios chain lookup trust

| | |
| --- | --- |
| **Severity** | **Low** |
| **Component** | `chain.ts` |
| **Issue** | Optional third-party API; integrity depends on Koios HTTPS and URL config. |
| **Impact** | Misleading “on-chain” status if provider compromised or misconfigured. |
| **Remediation** | Pin base URL; treat as advisory; prefer own node/Ogmios. |

---

### I-1 · Positive: VC verify requires challenge

`credentials` rejects empty challenges—avoids silent replay of challenge-less proofs.

### I-2 · Positive: Parameterized SQL in reviewed webapp paths

Deposit inserts and claim lookups use bind parameters—no classic SQLi found in those handlers.

### I-3 · Positive: Vault anti-double-satisfaction

`single_vault_input` + owner signature + burn -1 mitigates multi-vault one-signature attacks of the simple kind.

### I-4 · Positive: Mint requires oracle + vault shape

Locks terms and funding minimum at mint time.

### I-5 · Positive: Payment check challenge consume + TTL

Reduces trivial replay of the same challenge; short-lived signed checks.

---

## 5. Attack scenarios (end-to-end)

### A. “Internet demo box” takeover

1. Attacker finds `:8787` and `:55432`.  
2. Uses default DB or unauthenticated API.  
3. Opens deposits / reads all members / files presentments.  
4. If oracle CLI in demo mode watches the same DB → fraudulent attestations.

**Root causes:** C-2, H-1, C-1.

### B. Stolen CDT wallet

1. Attacker obtains member wallet keys.  
2. Freely transfers CDT or burns/redeems if vault path available.  
3. Payment-check may still pass if they control owner wallet field.

**Mitigations:** normal key custody; optional payment possession proof (M-4).

### C. Presentment without burn

1. Social-engineer redeeming desk using demo UI.  
2. Cash advanced; CDT still transferable.  
3. Sell/spend token; issuer eventually double-loss if both pay.

**Root causes:** H-3, H-4.

### D. Payment terminal MITM

1. Terminal fetches oracle pubkey from attacker-controlled API.  
2. Attacker signs fake “ok” checks.  

**Mitigation:** pin pubkey out-of-band (documented but easy to skip).

### E. Compromised mint oracle key

1. Attacker co-signs arbitrary MintCD datums (subject to vault funding).  
2. If attacker also controls vault funding inputs, mints fraudulent CDs.

**Mitigation:** HSM, dual control, monitoring (H-2, H-5).

---

## 6. Control coverage matrix

| Control | Implemented? | Notes |
| --- | --- | --- |
| AuthN/AuthZ APIs | ❌ | Critical gap |
| Rate limiting | ❌ | |
| TLS termination | ⚠️ | Not app-enforced |
| Secrets management | ⚠️ | Env defaults weak |
| VC verification (library) | ✅ demo | Production Identus TBD |
| VC verification (CLI path) | ❌ accept-all | |
| Mint oracle co-sign | ✅ | |
| Vault redeem rules | ✅ | Needs external audit |
| Double-mint on-chain | ⚠️ | Off-chain uniqueness |
| Presentment burn binding | ❌ | Spec only in docs/network |
| Payment-check signatures | ✅ | Ephemeral key ops gap |
| CIP/OFAC real checks | ❌ | UI only |
| Audit logging / SIEM | ❌ | Console logs only |
| Dependency scanning | ❓ | Not run this pass |
| Formal SC audit | ❌ | |

---

## 7. Priority remediation roadmap

### P0 — Before any non-lab network exposure

1. Bind API to localhost; firewall DB ports.  
2. Remove or hard-gate accept-all VC in any runnable path.  
3. No default passwords outside docker-dev profiles.  
4. Document “demo only” banner on UI.

### P1 — Before staff pilot with real-like data

1. Institution authentication (mTLS) for presentment/payment APIs.  
2. Persistent presentment registry with unique open claims.  
3. Stable oracle keys; never log private keys.  
4. Wallet challenge for ownership on presentment and payment verify.  
5. Hold-until-burn for any cash advance.

### P2 — Before member pilot

1. External smart-contract audit.  
2. Identus + revocation.  
3. HSM oracle; dual control mint.  
4. Rate limits, CSP, structured audit logs.  
5. bigint amounts; stable denomination.  
6. Penetration test of portal + oracle.

### P3 — Network scale

1. SettlementAuth signatures (network protocol).  
2. Reconciliation monitors for double presentment / duplicate asset names.  
3. Bug bounty after mainnet.

---

## 8. On-chain notes (for future auditor)

### Strengths

- Oracle required for mint.  
- Vault datum terms bound at mint.  
- Owner signature for redeem paths.  
- Burn of exactly one matching token.  
- Single vault input constraint.

### Questions for specialist audit

- All min-ADA / multi-asset output edge cases.  
- Validity interval malleability with owner-signed txs.  
- Whether issuer remainder checks can be satisfied via unrelated outputs
  (`lovelace_paid_to_key` aggregation).  
- Script size / budget under adversarial redeemers.  
- Staking credential / address type assumptions.  
- Interaction of free CDT transfer with off-chain insurance records.

---

## 9. Residual risk statement

Even after P0–P2, residual risks remain:

- Oracle honesty and key custody.  
- Free transfer vs insurance member-of-record mismatch.  
- Core system compromise.  
- Social engineering of tellers.  
- Regulatory reinterpretation of free-spend receipts.

These are **accepted product risks** only with governance, disclosure, and
limits—not something Plutus can fully eliminate.

---

## 10. Conclusion

The CDT prototype shows a **coherent security design at the mint/vault and VC
library layers**, with several **demo shortcuts that are unsafe if
operationalized as-is**. The newest surfaces (payment-check, presentment desk)
are **honest about free-spend** but **do not yet enforce settlement-grade
controls** (auth, real CIP, burn-before-cash, durable anti-double-presentment).

**Do not expose the current webapp, bank-sim Postgres, or oracle-watcher CLI to
untrusted networks.** Treat this audit as a backlog for the pilot gates in
`docs/network/` and `docs/rollout.md`.

---

## Appendix A — Quick reference findings

| ID | Severity | Title |
| --- | --- | --- |
| C-1 | Critical | Oracle CLI accept-all VCs |
| C-2 | Critical | Unauthenticated API control plane |
| H-1 | High | Default DB credentials / open port |
| H-2 | High | Ephemeral keys + private key logging |
| H-3 | High | Free-spend vs cash presentment double-pay |
| H-4 | High | Checkbox CIP/OFAC |
| H-5 | High | Off-chain-only mint uniqueness |
| M-1 | Medium | PII/claim enumeration |
| M-2 | Medium | No rate limits |
| M-3 | Medium | In-memory presentments |
| M-4 | Medium | Payment-check without possession proof |
| M-5 | Medium | Unrestricted BurnCD griefing |
| M-6 | Medium | JS number principal limits |
| M-7 | Medium | Fixed USD=ADA peg |
| L-1–L-3 | Low | localStorage “session”, headers, Koios trust |

## Appendix B — Suggested tracking

Open GitHub issues labeled `security` for C-1, C-2, H-1–H-5 before any pilot
hardware leaves the lab. Pair with network package burn-before-finality work.
