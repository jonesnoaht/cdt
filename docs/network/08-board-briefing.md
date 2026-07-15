# 08 — Board Briefing: CDT Settlement Network Pilot

**One-page briefing for credit union boards**  
**Date:** July 2026  
**Prepared by:** Noah Jones / CDT project  

---

## Decision requested

Authorize management to negotiate a **bilateral pilot** (or issuer-only /
redeemer-only seat) for multi-institution cash-out of **Certificate of Deposit
Tokens (CDTs)**, subject to counsel sign-off, BSA officer approval, and a hard
cap on exposure—**no broad public launch**.

## What is CDT?

A CDT is a **digital receipt** of a share certificate. **Member deposits stay
on the issuing credit union’s books** (NCUSIF as applicable). The token is
**not** itself NCUA-insured. Minting is gated by KYC credentials and an oracle
attestation. Redemption math is enforced by an on-chain vault; tokens may be
freely transferable as records.

## What is the Settlement Network?

Participating credit unions may **cash out** a member’s CDT via **account
credit or cash**, then **settle with the issuing CU** after the token is
**burned** so it cannot be paid twice. This is a **correspondent presentment**
model—not a crypto exchange.

```text
Member → Redeeming CU (CIP + credit) → Issuer (verify + settle) → Burn CDT
```

## Why consider it?

| Benefit | Detail |
| --- | --- |
| Member utility | Certificate usable beyond our branch footprint |
| Competitive | Digital convenience without uninsured “yield” apps |
| Controlled | Caps, auth signatures, burn-before-finality options |
| Cooperative | Strengthens CU-to-CU utility |

## Key risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Wrong person paid | CIP/OFAC + wallet proof + name match |
| Double cash-out | Unique burn + core close + presentment registry |
| Liquidity | Daily advance caps or hold-until-burn |
| Reputation / “insured crypto” | Strict disclosure; marketing review |
| Technology | Pilot caps; tabletop; vendor diligence (22-CU-07) |

## Regulatory posture (high level)

NCUA guidance recognizes FICU use of DLT for permissible activities with board
oversight (e.g., Letter 22-CU-07). This pilot uses DLT as **record/servicing
tech for share certificates**, not as uninsured digital asset custody of member
principal. Counsel and, as appropriate, NCUA engagement before real-member
volume.

## Pilot envelope (fill in)

| Parameter | Proposal |
| --- | --- |
| Role | [ ] Issuer  [ ] Redeemer  [ ] Both |
| Partner CU | ________________ |
| Duration | ____ months |
| Max outstanding advances | $________ |
| Max single presentment | $________ |
| Finality policy | Hold-until-burn / Advance-with-cap |
| Budget (external) | $________ |
| Executive sponsor | ________________ |

## Documents available

Full package: `docs/network/` — business proposal, MOU template, member
addendum, presentment form, messaging spec, ops procedures, fee draft, risk
memo.

## Recommended resolution (sample)

> RESOLVED, that management is authorized to negotiate and execute a pilot
> memorandum of understanding for CDT settlement activities within the exposure
> caps presented to this Board, subject to final approval of legal counsel and
> the BSA officer, and to report results at the next regular meeting after
> pilot month three.

---

**Contact:** Noah Jones · CDT project repository `docs/network/`
