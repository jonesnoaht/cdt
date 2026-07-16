# CDT Credit-Claim Product — Design Spec

**Date:** 2026-07-16  
**Author:** Noah T. Jones (with Grok)  
**Status:** Approved design — ready for implementation plan  
**Repo:** `cdt` (Certificate of Deposit Token)  
**Supersedes (as primary product):** vault-held principal + interest redeem as the member-facing product definition  

> **Not legal, tax, or investment advice.** This is a product and engineering blueprint for
> counsel, credit-union boards, BSA officers, and implementers. Real member funds require
> board approval, regulator engagement, and licensed professional review.

---

## 0. Decisions locked in brainstorming

| Decision | Choice |
|---|---|
| Primary product | **CD-collateralized bearer credit claim** (replaces vault interest-as-product) |
| Coupon | **Original depositor**, on full pledged certificate |
| Commerce path | **Not** partial on-book CD withdrawal |
| Cash-out liability | **Always original depositor’s secured LOC** (presenter is not the borrower) |
| Mint model | **CDT = full available credit** at open (e.g. LTV × principal) |
| Maturity | **Waterfall B** + **optional rollover re-issue** (no silent perpetual float) |
| Hold / transfer | **Bearer free-spend** |
| Cash-out controls | **CIP/OFAC (etc.) at presentment** |
| Architecture | **Core-led facility** + on-chain claim token; multi-CU network = phase 2 |
| Product modes | **Replace** dual-mode; credit claim is the primary CDT product |

---

## 1. Purpose & architecture spine

### 1.1 Purpose

Rework CDT so the primary product is:

> A member opens an insured **share certificate / CD**, keeps the **coupon** on that
> certificate, receives **bearer CDT** equal to a **secured line of credit** against it,
> and others can **accept and spend** that CDT. When a holder cashes out, the **original
> depositor’s LOC is drawn**; the recipient only receives money.

**Major draw (user strategy, outside or adjacent to the product):** borrow → deposit into
certificate → mint CDT → use CDT in commerce while the depositor keeps the coupon. Liquidity
for commerce is **credit**, typically priced near **certificate rate + 2–3.5%** on draws—not
free partial withdrawal of the CD.

**Non-goals (v1):**

- Multi-CU settlement network (phase 2)
- Chain as credit system of record
- Company or DAO taking the coupon as revenue
- Partial CD principal reduction as the normal commerce path
- DAO governance of rates or facilities

### 1.2 Trust split

| Layer | System of record for | Why |
|---|---|---|
| **CU core** (`bank-sim` → real core) | CD balance, coupon, pledge/freeze, LOC limit/drawn/available, cash-out CIP/OFAC, maturity waterfall, re-issue underwriting | Examinable banking products |
| **Cardano** | CDT asset supply, series identity, maturity pin, bearer balances, burn on presentment | Portable free-spend units + public supply discipline |
| **Oracle / control plane** | Attest mint ≤ core available credit; co-sign burns only after core accepts draw | Bridge; not the lender |

**Invariants:**

1. `on_chain_CDT_supply(series) ≤ facility.limit`
2. `drawn + available + holds = limit` (core)
3. Presentment amount `X` eventually yields `drawn += X` and `supply -= X`
4. `CLOSED` ⇒ `supply = 0` and LOC terminal per policy
5. Re-issue ⇒ `supply ≤ new_limit` before return to ACTIVE

### 1.3 Runtime diagram

```text
┌─────────────────────────────────────────────────────────────┐
│ Member / holders / merchants (wallets — bearer free-spend)  │
└────────────┬───────────────────────────────┬────────────────┘
             │ transfer CDT                  │ present for cash
             ▼                               ▼
┌────────────────────────┐     ┌─────────────────────────────┐
│ Cardano                │     │ Presentment desk / API      │
│ • CDT native asset     │     │ • CIP/OFAC at cash-out      │
│ • series metadata      │     │ • request draw on depositor │
│ • burn on settle       │     └──────────┬──────────────────┘
└────────────▲───────────┘                │
             │ mint / burn                ▼
┌────────────┴───────────┐     ┌─────────────────────────────┐
│ Oracle / pipeline      │◄───►│ CU core                     │
│ • read LOC/CD state    │     │ • CD (coupon to depositor)  │
│ • mint to limit        │     │ • secured LOC               │
│ • finalize after draw  │     │ • waterfall / re-issue      │
└────────────────────────┘     └─────────────────────────────┘
```

### 1.4 Phasing

| Phase | Ships |
|---|---|
| **v1** | Single issuer; core-led CD+LOC; mint CDT=available credit; bearer transfer; cash-out draws depositor LOC + burn; maturity waterfall; optional re-issue |
| **v2** | Multi-CU presentment network (redeeming CU pays presenter; issuer settles; still draws original depositor LOC) |
| **Later** | Real core adapter, Identus production path, HSM oracle keys, counsel opinions at volume |

---

## 2. Lifecycle & money flows

### 2.1 Actors

| Actor | Role |
|---|---|
| **Depositor (member)** | Opens CD, pledges it, sole borrower on LOC; receives initial CDT; keeps coupon on CD |
| **Holder** | Anyone holding CDT after transfer (bearer); may present for cash |
| **Issuer CU** | Books CD + secured LOC; freeze/pledge; CIP/OFAC at cash-out; waterfall/re-issue |
| **Oracle / control plane** | Mints to core limit; finalizes burns after core draw succeeds |
| **Presentment desk** | Issuer channel where holder exchanges CDT → money |
| **CDT Labs (vendor)** | Software, oracle, validators—not lender of record in v1 |

### 2.2 Series states

A **series** = one pledged CD + one LOC + one CDT asset/namespace with pinned maturity.

```text
DRAFT → OPEN → ACTIVE → MATURING → CLOSED
                │            │
                └──── REISSUE (optional; new term / successor pin)
```

| State | Meaning |
|---|---|
| **OPEN** | CD booked, LOC approved, freeze on, CDT minted to depositor = `LOC_limit` |
| **ACTIVE** | Transfers allowed; presentments draw LOC and burn CDT |
| **MATURING** | Maturity window; clear float; optional re-issue decision |
| **REISSUE** | New CD term + re-underwritten LOC; supply must be ≤ new limit |
| **CLOSED** | Waterfall done; supply = 0; freeze released per policy |

### 2.3 Happy paths

**Open (mint = full available credit)**

1. Member completes open flow and disclosures (CD + LOC + bearer-draw warning).
2. Core: book CD; open secured LOC; pledge/freeze CD; `limit = LTV × principal`.
3. Oracle reads limit → mints `CDT_total = limit` to depositor wallet.
4. Coupon accrues on **full CD principal** to depositor on core, independent of who holds CDT.

**Commerce (bearer transfer)**

- Holder_A sends CDT → Holder_B with no oracle and no core.
- Meaning: B controls that much **claim on depositor’s undrawn LOC capacity**.
- No draw yet; coupon unchanged.

**Cash-out (liability always depositor)**

1. Holder presents amount `X` at issuer desk/API.
2. Desk: CIP/OFAC on presenter; series must be presentable.
3. Core: draw `X` on **depositor’s** LOC (reject if `X > available`).
4. Core: pay presenter `X` (account credit or cash).
5. Chain: burn `X` CDT.
6. Depositor owes `X` more on LOC; pays LOC interest on drawn balance.
7. CD remains intact; coupon still on full pledged principal.

**Maturity waterfall (default B)**

At CD/series maturity:

1. Stop new mint exposure; enter MATURING.
2. Apply CD proceeds on core:
   1. Repay **drawn LOC** (interest/fees per note).
   2. Cash out remaining on-chain CDT (pro rata if shortfall).
   3. Residual to depositor.
3. Burn remaining CDT as claims are paid (or bulk redeem path).
4. CLOSED when supply = 0 and LOC terminal per policy.

**Optional rollover re-issue**

In the maturity window, only if depositor **and** CU approve:

1. Core: renew/replace CD; re-underwrite LOC; new limit, rate, maturity.
2. If `outstanding_CDT > new_limit`, reduce float first (present/burn or depositor buyback).
3. Oracle re-pins series maturity/limit.
4. Return to ACTIVE under new term.  
   If re-issue fails or is declined → waterfall B (no silent immortality).

### 2.4 Money truth table

| Event | CD principal | Coupon to | LOC drawn | CDT supply | Cash to |
|---|---|---|---|---|---|
| Open | Booked | Depositor (ongoing) | 0 | = limit | — |
| Transfer | Unchanged | Depositor | Unchanged | Unchanged | — |
| Cash-out X | Unchanged | Depositor | ↑ X | ↓ X | **Presenter** |
| LOC interest | Unchanged | Depositor (on CD) | Interest on loan | Unchanged | CU earns spread |
| Maturity waterfall | Closed/paid | Final CD economics | → 0 via proceeds | → 0 | CDT holders, then residual to depositor |
| Re-issue | New/rolled CD | Depositor | May carry/refinance | ≤ new limit | — |

### 2.5 Edge flows

| Case | Behavior |
|---|---|
| Presentment > available | Reject; no pay, no burn, no draw |
| Core draw+pay succeeds, burn fails | Core wins; mark paid; retry burn; **halt new mints** for series until reconciled |
| Burn succeeds, pay fails | Ops reverse/compensate per runbook; no silent unbacked burn policy |
| Maturity shortfall | Pro rata to CDT holders after drawn LOC; disclosed at open |
| Depositor LOC default | Enforce pledge per loan docs; CDT claims follow contractual recovery waterfall—not “token = NCUSIF” |
| Key loss | Bearer risk; optional issuer reissue only under explicit ops/legal policy |

### 2.6 Explicit non-behaviors

- Partial **on-book CD principal** cuts as normal commerce
- Moving **coupon** to CDT holders
- Making the **presenter** the borrower
- CDT surviving maturity **without** re-issue attestation

---

## 3. Data model & core↔chain objects

### 3.1 Principles

1. Core is authoritative for credit, deposit, and cash.
2. Chain is authoritative for bearer unit balances and public supply.
3. Every series points at a core facility id; every presentment is a core transaction with optional burn tx hash.
4. No PII on-chain (ids, amounts, hashes, timestamps, payment key hashes only).

### 3.2 Core objects

**Certificate** — `certificate_id`, `member_id`, `principal`, rate/dividend terms, `start_at`, `maturity_at`, status, pledge status.

**CreditFacility** — `facility_id`, `certificate_id`, `borrower_member_id` (always original depositor), `limit_amount`, `drawn_amount`, `available_amount`, `rate_bps` (typically CD + spread), `ltv_bps`, status, `series_id`.

**Presentment** — `presentment_id`, facility/series, `amount`, presenter CIP ref, status (`requested` / `drawn` / `paid` / `burned` / `failed` / `reconciled`), draw txn, payout txn, `burn_tx_hash`.

**FacilityEvent** — append-only audit log (open, draw, repay, re-issue, waterfall, reconcile).

**ReissueDecision** — approve/decline/lapse, new maturity/limit/rate, timestamp.

### 3.3 On-chain objects

**CdtSeries** (datum or registry) — `series_id`, facility binding commitment, issuer/oracle keys, `maturity`, limit/max mint, state.

**CDT asset** — integer minor units (mille-capable); asset name derived from series; permissionless transfer; oracle-gated mint; burn on presentment finalize.

**Not on-chain in v1:** LOC interest accruals, coupon accruals, CIP payloads, full waterfall ledgers (optional settlement receipt hash later).

### 3.4 Control plane

- **MintAttestation** — series, limit, maturity, recipient, core snapshot, signature
- **BurnAttestation** — series, amount, presentment id, core draw id, signature
- **ReconcileReport** — supply vs limit/drawn/open presentments; alert on drift

### 3.5 Mapping from legacy CDT

| Legacy concept | Fate |
|---|---|
| `cd_vault` + interest math as product | Demote/retire from primary path |
| `cdt_mint` + deposit_id asset | Repurpose → facility/series credit units |
| Oracle deposit observe | Repurpose → facility open/limit/draw |
| Credentials | Keep for **facility open**; cash-out uses desk CIP |
| Webapp redeem | Presentment (draw + burn), not mature-interest vault |
| `docs/network/` multi-CU | Phase 2; same liability rule |

### 3.6 Issuer API (conceptual)

```text
POST /facilities
GET  /facilities/:id
POST /presentments
POST /presentments/:id/complete
POST /facilities/:id/reissue
POST /facilities/:id/waterfall
GET  /reconcile/series/:id
```

---

## 4. Risk controls, disclosures & compliance posture

### 4.1 Context

Older CDT compliance materials treated **non-transferability** as a primary securities/money-transmission control. This design **enables bearer transfer by choice**. Residual controls are: real CD + secured LOC on books; no yield marketed to CDT holders; cash-out KYC; LTV/caps; maturity waterfall; marketing discipline; counsel opinions before real volume.

### 4.2 Risk register (summary)

| Risk | v1 control |
|---|---|
| Bearer draw on depositor | Open disclosures; UX warnings; optional velocity caps |
| Over-mint / double-pay | Core authorizes draws; attested mint limit; reconcile; halt mint on drift |
| Draw/burn desync | State machine; retry burn; halt mint; core wins |
| Maturity shortfall | LTV buffer; pro rata; disclose |
| Default | Pledge enforcement; contractual priority—not token insurance |
| BSA / sanctions | CIP/OFAC every cash-out; monitoring/SAR |
| Stolen wallet | Bearer risk; education; optional large-presentment cool-off |
| Misrepresentation | Locked marketing; no “insured token / holder coupon” |
| Securities / notes | Banking structure; no holder yield; **opinion required** |
| Money transmission | Issuer CU pays presenters; Labs is vendor |
| ALM / liquidity | Facility and book caps; stress pause rights (disclosed) |

### 4.3 Pilot parameter defaults (tunable)

| Parameter | Suggested pilot default |
|---|---|
| LTV | 90% of CD principal |
| LOC rate | CD APY + 2.00% to 3.50% |
| Max facility size | Board pilot cap (e.g. $25k–$100k) |
| Issuer book cap | Portfolio cap on outstanding CDT face |
| Single presentment max | Pilot cap (e.g. $2k–$10k) |
| Daily presentment per facility | Count and/or $ cap |
| Maturity window | e.g. T−7 … T+0 (align to certificate rules) |
| Re-issue | Dual opt-in; supply ≤ new limit first |

### 4.4 Disclosures (required)

**Depositor at open:** CDT not NCUSIF-insured; CDT lets others draw my LOC; I am sole borrower; I keep CD coupon and pay LOC interest on draws; waterfall unless re-issue; possible shortfall pro rata; bearer/key risk; CU may pause presentments under disclosed policy.

**Presenter at cash-out:** Receiving bank payment, not redeeming insured deposit token; CIP/OFAC required; no coupon for holding CDT.

**Separate TISA / loan disclosures** for certificate and LOC—do not invent a “token APY” for holders.

### 4.5 Accountability

| Party | Accountable for |
|---|---|
| CU board / management | Product approval, risk appetite, DLT oversight |
| CU BSA | Cash-out CIP/OFAC, monitoring |
| CU lending | Underwriting, pledge, default, re-issue |
| CDT Labs | Correct bridge, logs, no silent limit bugs |
| Depositor | Bearer understanding; servicing LOC |
| Counsel | Securities, UCC characterization, deposit/loan/token terms |

### 4.6 Pilot acceptance (risk)

1. No presentment paid without matching core draw  
2. No sustained `supply > limit`  
3. Maturity drill completes with supply → 0  
4. Re-issue approve and decline both tested  
5. Disclosure/marketing review before real members  
6. Independent review of mint/burn + state machine before mainnet real value  

---

## 5. Engineering plan

### 5.1 Repo impact

```text
bank-sim/       Certificate + CreditFacility + Presentment + waterfall + re-issue
credentials/    Depositor/issuer open path (optional at cash-out)
onchain/        Mint/series primary; demote cd_vault interest product
offchain/       cdt-txlib, oracle-watcher, pipeline, demo rewritten for facility lifecycle
webapp/         Open facility, free-spend, presentment desk, issuer maturity/re-issue
docs/           Product, compliance, manual, whitepaper alignment to this spec
```

### 5.2 On-chain minimalism (v1)

**On-chain:** mint (oracle), bearer transfer, burn, series maturity/limit/state.  
**Off-chain only:** LOC interest, coupon, CIP, full waterfall ledger.

### 5.3 Acceptance flows

1. Open → mint CDT = limit to depositor wallet  
2. Transfer to second wallet  
3. Present → draw depositor LOC → pay presenter → burn  
4. Assert CD intact, coupon still depositor, drawn = face, supply down  
5. Maturity waterfall → supply 0, LOC 0  
6. Re-issue approve path; decline → waterfall  
7. Over-available presentment rejected  

### 5.4 Testing

- Unit: bank-sim facility math, waterfall order, re-issue gate, shortfall pro rata  
- Unit: txlib mint/burn/transfer  
- Invariants: supply ≤ limit; drawn+available+holds=limit; closed ⇒ supply 0  
- Integration: oracle + bank-sim + chain demo  
- Webapp e2e: two wallets + presentment  
- Ops: pay-without-burn desync drill  
- Legacy vault tests: quarantine or delete from primary CI path  

### 5.5 Delivery slices

| Slice | Outcome |
|---|---|
| S1 | bank-sim domain + tests |
| S2 | API/pipeline open + presentment (mock mint/burn ledger OK) |
| S3 | on-chain mint/burn + txlib |
| S4 | oracle reconcile + desync handling |
| S5 | webapp open / transfer / present |
| S6 | maturity waterfall + re-issue |
| S7 | docs rewrite + demo + readiness checklist |

### 5.6 Phase 2

Multi-CU network presentment; real core adapter; Identus; HSM keys; counsel + board package at volume; optional depositor kill-switch / daily caps as product features.

---

## 6. Open issues & counsel flags

These are **known follow-ups**, not unresolved product forks:

1. **Securities characterization** of bearer transferable claims on a member LOC—opinion before real volume.  
2. **UCC / claim priority** of CDT holders vs CU as secured lender on default.  
3. **Exact TISA and loan disclosure language** for dual CD + LOC + token package.  
4. **Whether presentment pause** is a contractual right under stress (recommended yes, disclosed).  
5. **Pro rata shortfall formula** (by face held at maturity snapshot time).  
6. **Unit denomination** (USD cents vs mille of principal) and FX if demo remains ADA-denominated.  
7. **Production core adapter** interface (beyond bank-sim)—out of v1 code but design-stable via facility API.  
8. **Legacy vault code retirement schedule** (quarantine vs delete).  
9. **Optional depositor controls** (velocity, pause) timeline—recommended soon after S5 if pilot risk demands.  
10. **Company revenue** (SaaS, issuance bps, presentment fees)—orthogonal to coupon; business plan update separate.

---

## 7. Success criteria (product + eng)

1. Primary docs and UI describe **credit claim**, not “holder earns vault interest.”  
2. All §5.3 flows green in local demo.  
3. Invariant tests green.  
4. One documented maturity drill and one re-issue drill.  
5. No primary path that pays coupon to CDT holders or treats presenters as borrowers.  

---

## 8. Next step

Create an implementation plan (writing-plans) ordered by slices S1–S7, starting with bank-sim facility domain tests.
