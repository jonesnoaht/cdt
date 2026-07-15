# CDT Settlement Network — Business Proposal

**Title:** Portable Share Certificates with Multi-Institution Cash-Out  
**Product:** Certificate of Deposit Token (CDT) Settlement Network  
**Author:** Noah Jones  
**Date:** July 2026  
**Status:** Working draft for pilot partners and counsel  
**Version:** 0.1  

**Document package:** [Network docs index](./README.md)

---

> **Disclaimer.** This proposal is a planning document. It is not an offer to
> sell securities, deposits, or network membership interests; not a solicitation
> of investment; and not legal, tax, accounting, or investment advice. No
> institution should accept real member funds into a CDT program or settle
> presentments without board approval, qualified counsel, and engagement with
> the NCUA and applicable state supervisors. Financial figures below are
> **illustrative assumptions**, not forecasts.

---

## 1. Executive summary

Credit unions issue billions of dollars of **share certificates** (CDs) that
are safe, supervised, and insured—but **stuck at the issuer**. A member who
moves, banks at a different CU, or needs cash away from home cannot easily
evidence or liquidate that certificate without calling the original
institution and waiting on manual processes.

**CDT** already solves the **record** problem: the deposit stays on the
issuer’s core; a Cardano-native **receipt token** carries the contract terms;
minting is gated by **KYC credentials** and an **oracle attestation**.

This proposal extends CDT with a **Settlement Network**: any **participating
credit union** can, under contract:

1. Verify a foreign CDT against the **issuer’s** attested claim,  
2. **Credit the holder’s account** (or pay cash) at the redeeming CU, and  
3. Receive **settlement** from the issuer after the CDT is **burned** (or
   cancelled under issuer recovery) so the claim cannot be cashed twice.

### The ask of pilot partners

| Partner role | Commitment |
| --- | --- |
| **Issuing CU** (e.g. CampusUSA) | Board-sponsored pilot; member T&Cs; oracle/keys; settle presentments |
| **Redeeming CU** (second institution) | Bilateral MOU; desk procedures; CIP walk-ins; temporary advances or holds |
| **Network / CDT Labs** | Software, messaging protocol, ops playbooks, document package, integration support |

**Outcome of a successful pilot:** a member can walk into a second CU with a
CDT, complete local identification, and receive a **share draft / account
credit**, while the issuer closes the certificate and pays the redeeming CU—
exactly the “burn agreement + communication between redeemer and issuer”
model, productized.

---

## 2. The problem (network lens)

| Stakeholder | Pain today |
| --- | --- |
| **Member** | Certificate is portable only by paperwork; cash-out only at issuer |
| **Issuing CU** | Servicing cost; cannot offer “use anywhere” convenience |
| **Other CUs** | No safe way to honor another CU’s CD without bilateral trust and process |
| **Movement** | Loses members to Big Tech / crypto “yield” products with no NCUSIF |

Tokenized *payments* (stablecoins) do not solve **term deposits**. CDT
targets the certificate niche specifically.

---

## 3. Solution: burn-and-settle network

### 3.1 Product promise

> **Any CDT holder may present at any participating credit union for cash-out
> via account transfer (or cash), subject to identity checks, issuer
> authorization, and unique burn of the token.**

### 3.2 What moves where

| Asset | Location | Moves when |
| --- | --- | --- |
| Insured deposit liability | **Issuer core only** | Closed when certificate paid |
| Member cash / share credit | **Redeeming CU** (or cash) | After local CIP + issuer auth (policy) |
| Settlement funds | Issuer → Redeeming CU | ACH/wire after burn evidence |
| CDT | Holder wallet → burned | On Redeem / EarlyWithdraw |

### 3.3 Roles

```text
┌─────────────┐     presentment      ┌─────────────┐
│  Redeeming  │ ──────────────────►  │   Issuing   │
│     CU      │ ◄──────────────────  │     CU      │
└──────┬──────┘   SettlementAuth     └──────┬──────┘
       │         + settlement $             │
       │                                    │ vault
       ▼                                    ▼
   Member account                      Burn CDT on Cardano
   credit / cash                       Close CD on core
```

### 3.4 Free-spend vs settlement

CDT remains **freely transferable** as a native asset. That does **not**
automatically retitle the insured deposit. Network cash-out is a **regulated
desk process** with:

- claim lookup,  
- issuer-signed **SettlementAuth**,  
- **burn evidence**,  
- inter-CU settlement.

Merchants may separately use the opt-in **payment-check** contract
(`cdt.payment_check.v1`) without becoming deposit insurers.

---

## 4. Value proposition

### 4.1 For members

- Portable certificate evidence in a wallet.  
- Cash-out at a CU near them, not only the issuer’s branch network.  
- Same rate/penalty math as disclosed at opening.  
- Deposit remains NCUSIF-eligible **at the issuer** until paid.

### 4.2 For issuing credit unions

- Differentiated digital certificate product.  
- Lower manual “is this real?” inquiries.  
- Controlled liquidity of certificates without building a DEX.  
- Data: presentment volume as member utility metric.

### 4.3 For redeeming credit unions

- New member acquisition (walk-in opens an account to receive credit).  
- Fee income for presentment.  
- Cooperative positioning (“we honor the movement’s digital certificates”).  
- Risk capped by issuer auth, limits, and burn-before-finality policy.

### 4.4 For the network operator (CDT Labs / CUSO)

- SaaS: messaging hub, oracle services, desk software, audit logs.  
- Per-presentment and per-issuer subscription revenue (see fee schedule).  
- Path from bilateral pilots to multi-state CUSO distribution.

---

## 5. How it works (business process)

### 5.1 Happy path — account transfer at redeeming CU

1. **Member** arrives with CDT (deposit_id) and ID.  
2. **Redeeming CU** looks up claim at issuer (live, terms, cash-out quote).  
3. Redeeming CU completes **local CIP/OFAC** and ownership proof.  
4. Redeeming CU files **PresentmentRequest**; issuer returns signed
   **SettlementAuth** (amount, mode mature/early, expiry).  
5. Redeeming CU **credits member share account** (or holds until burn).  
6. Member (or agent flow) completes **on-chain burn** via Redeem or
   EarlyWithdraw.  
7. Redeeming CU submits **BurnEvidence** (tx hash).  
8. Issuer closes certificate on core and **ACH/wires** redeeming CU.  
9. Presentment marked **settled**; further presentments for that deposit_id
   rejected.

### 5.2 Failure / fraud paths (summary)

| Scenario | Control |
| --- | --- |
| Already redeemed | Issuer lookup fails / status closed |
| Wrong person | Name + CIP + wallet proof mismatch → refuse |
| Token still spendable after cash | Policy: no final credit without burn; or clawback under agreement |
| Issuer delay | SLA + caps on redeeming CU daily exposure |
| Lost keys | Issuer recovery path (re-verify member, cancel stranded token) |

Full ops: [Operating procedures](./06-operating-procedures.md).

---

## 6. Commercial model (illustrative)

| Stream | Payer | Assumption (pilot) |
| --- | --- | --- |
| Issuer platform fee | Issuing CU | $2k–$8k / month SaaS (scale with deposits) |
| Presentment fee | Issuer or redeemer (negotiated) | $5–$25 flat + 0–15 bps of cash-out |
| Integration / pilot | Pilot CU | $25k–$75k professional services |
| Network membership | Participating CUs | Annual fee after Phase 2 |

Detailed draft: [Fee schedule](./07-fee-schedule.md).  
Company-level fundraising narrative remains in
[business-plan.md](../business-plan.md).

---

## 7. Pilot design (Phase 0–1)

### 7.1 Goals

- Prove one **issuer** + one **redeemer** can complete **10–50** presentments
  end-to-end with staff or friendly accounts.  
- Validate SLA, fee economics, BSA checklist, and dual-control burn.  
- Produce board-ready evidence for Gate expansion.

### 7.2 Scope

| In scope | Out of scope (pilot) |
| --- | --- |
| Bilateral MOU | Full multilateral Master Agreement |
| API or secure portal for lookup/auth | Open DEX market making |
| ACH settlement T+1 | Instant RTP required |
| Early + mature cash-out quotes | Partial presentment of one CD (optional later) |
| Staff / limited member accounts | Unlimited public marketing |

### 7.3 Success metrics

| Metric | Target (illustrative) |
| --- | --- |
| Successful presentments | ≥ 20 without loss event |
| Median time lookup → auth | < 5 minutes (automated) |
| Median time burn → settlement | ≤ 1 business day |
| False accepts (wrong person paid) | 0 |
| Double cash-out | 0 |
| Member NPS / staff usability | Qualitative pass |

### 7.4 Partners

| Seat | Candidate |
| --- | --- |
| Issuer | CampusUSA Credit Union (historical design partner interest) |
| Redeemer | Second Florida CU or league-introduced partner |
| Technology | CDT Labs / project team |
| Counsel | Banking + payments counsel (each CU + network) |

---

## 8. Technology alignment

| Capability | Prototype today | Pilot need |
| --- | --- | --- |
| Mint + vault | Aiken validators | Audit + mainnet/testnet deploy |
| Oracle mint attestation | Oracle watcher + pipeline | HSM keys, dual control |
| Claim lookup / presentment UI | Webapp `#/present` | Persistent presentment DB + statuses |
| Payment-check (merchants) | `#/pay` / `cdt.payment_check.v1` | Optional Phase 2 |
| SettlementAuth messages | Spec only | Sign with issuer keys |
| Burn evidence | Redeem CLIs / pipeline | Redeemer submits tx hash |
| Core integration | bank-sim | Real core or middleware |

Protocol: [Messaging & API](./05-messaging-protocol.md).  
Architecture: [architecture.md](../architecture.md).  
Whitepaper: [whitepaper.md](../whitepaper.md).

---

## 9. Risk overview

| Risk | Mitigation |
| --- | --- |
| Double payment | Unique burn + core close + presentment registry |
| Securities / secondary market optics | Cash-out is redemption-like servicing, not yield trading; counsel review marketing |
| BSA gaps at redeemer | Local CIP/OFAC mandatory; training; transaction monitoring |
| Liquidity at redeemer | Daily advance caps; hold-until-burn option |
| Oracle key compromise | HSM, dual control, 72-hour cyber reporting readiness |
| Member confusion on insurance | Mandatory disclosure: deposit insured at **issuer**; token not insured |

See [Risk & compliance memo](./09-risk-and-compliance-memo.md) and
[compliance.md](../compliance.md).

---

## 10. Regulatory and governance

- Board resolution at each pilot CU (DLT use under NCUA 22-CU-07 framing).  
- Written risk assessment; third-party diligence on CDT Labs / vendors.  
- BSA program updates for presentment and CD funding patterns.  
- Truth in Savings consistency: cash-out math = disclosures.  
- Clear Part 740-style advertising: no “NCUA-insured crypto.”  
- Engage regional NCUA office before real-member presentments.

---

## 11. Implementation roadmap

| Phase | Deliverable | Exit gate |
| --- | --- | --- |
| **0** | MOU + manual presentment + wire | 5 manual successes |
| **1** | Bilateral API + desk UI + ACH | Metrics in §7.3 |
| **2** | Master Network Agreement + 5+ CUs | Legal package executed |
| **3** | Hub/CUSO production + merchant checks | Volume & loss rate SLAs |

Aligns with broader product rollout in [rollout.md](../rollout.md).

---

## 12. Investment / resource ask (pilot)

**Not a securities offering.** Illustrative resource envelope for a 6–9 month
bilateral pilot:

| Item | Range (USD) |
| --- | --- |
| Engineering (SettlementAuth, presentment SM, burn evidence, ACH ops tooling) | 80k–200k |
| Security review (oracle + presentment) | 25k–75k |
| Legal (MOU, member addendum, network terms) | 40k–120k |
| CU staff time (issuer + redeemer) | in-kind |
| Contingency | 15% |

Funding may come from pilot CU professional-services fees, grants, or company
seed (see business plan)—to be decided by the venture’s entity structure.

---

## 13. Decision requested

Pilot partners are asked to:

1. **Designate** executive sponsor + BSA + treasury contacts.  
2. **Authorize** counsel to negotiate the [Bilateral MOU](./02-bilateral-mou.md).  
3. **Schedule** a technical workshop on claim lookup and burn evidence.  
4. **Agree** in principle to a staff pilot without public marketing.  
5. **Review** board briefing ([08](./08-board-briefing.md)) for next board cycle.

---

## 14. Contact and next steps

**Author:** Noah Jones  
**Package:** `docs/network/` in the CDT repository  

### Immediate next steps

1. Choose issuer + redeemer seats.  
2. Redline bilateral MOU.  
3. Implement SettlementAuth + presentment state machine on the prototype.  
4. Run tabletop: fraud, double presentment, lost keys, settlement delay.  
5. Board package → limited pilot.

---

## Appendix — Document map

| Need | Document |
| --- | --- |
| Sell the network | This proposal |
| Multilateral legal outline | [01-master-network-agreement](./01-master-network-agreement.md) |
| Start with two CUs | [02-bilateral-mou](./02-bilateral-mou.md) |
| Member authorization | [03](./03-member-terms-addendum.md), [04](./04-presentment-burn-authorization.md) |
| Build the wires | [05-messaging-protocol](./05-messaging-protocol.md) |
| Run the desk | [06-operating-procedures](./06-operating-procedures.md) |
| Price it | [07-fee-schedule](./07-fee-schedule.md) |
| Board | [08-board-briefing](./08-board-briefing.md) |
| Risk | [09-risk-and-compliance-memo](./09-risk-and-compliance-memo.md) |
