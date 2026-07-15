# 09 — Risk & Compliance Memo (Settlement Network)

**To:** CRO, BSA Officer, General Counsel, Executive Sponsor  
**From:** CDT project (planning)  
**Date:** July 2026  
**Re:** Risk themes for multi-CU CDT presentment & settlement  
**Status:** Discussion memo — not a formal legal opinion  

---

## 1. Scope

This memo flags risk and compliance themes for a network in which CDTs
(tokenized share certificate receipts) may be cashed out at participating
credit unions with settlement from the issuer after burn. It complements
[compliance.md](../compliance.md) (product-level analysis).

## 2. Product characterization

| Assertion | Implication |
| --- | --- |
| Deposit stays on issuer core until paid | NCUSIF analysis focuses on issuer’s certificate |
| Token is a receipt | Free transfer ≠ automatic insurance retitle |
| Presentment is servicing / correspondent collection | Closer to agency cash-out than to issuing a new insured CD at redeemer |
| Burn prevents double pay | Critical control—operational and contractual |

**Residual risk:** plaintiffs or examiners could recharacterize free trading +
yield marketing as investment-contract activity (*Gary Plastic* family of
concerns). **Mitigation:** deposit-like marketing; cash-out framed as
certificate servicing; avoid secondary-market yield promotion.

## 3. BSA / AML / OFAC

| Control point | Owner |
| --- | --- |
| CIP at certificate open | Issuer |
| Credential issuance after CIP | Issuer |
| Mint attestation screening | Issuer oracle |
| CIP/OFAC of walk-in at cash-out | **Redeemer** |
| SAR on suspicious presentment patterns | Both (as applicable) |
| Travel Rule | Generally not a member-to-member funds transmission if redeeming CU pays its customer and settles with issuer as principal/agent—**confirm with counsel** for your fact pattern |

Redeemer must not treat issuer’s historic KYC as a substitute for identifying
the person receiving cash today.

## 4. Safety & soundness / liquidity

- Redeemer advances create **credit exposure** to issuer until settlement.  
- Set **daily caps**, **per-item limits**, and optional **hold-until-burn**.  
- Issuer needs operational capacity to settle ACH same/next day.  
- Concentration risk if one redeemer dominates presentments.

## 5. Operational risk

| Failure | Control |
| --- | --- |
| Double presentment | Registry + burn uniqueness |
| SettlementAuth forgery | Pin issuer keys; mTLS |
| Chain indexer lag | Delay BurnAccepted; don’t settle on unconfirmed tx |
| Key compromise (oracle/settlement) | HSM, dual control, rotation, incident plan (72-hour cyber reporting readiness) |
| Core/chain mismatch | Daily reconciliation reports |

## 6. Consumer protection

- Clear **insurance disclosure** at open and at presentment.  
- Early-withdrawal penalty math identical to TISA disclosures.  
- Avoid dark patterns that push early cash-out.  
- Complaint handling across two CUs—designate owner of member communication.

## 7. Privacy (GLBA)

- Share minimum data for presentment (name match, claim status, amounts).  
- Service-provider agreements if Operator processes NPI.  
- No PII in on-chain datums (already an architecture invariant).

## 8. Third-party / DLT governance (NCUA 22-CU-07 lens)

Board should see: purpose, risk assessment, vendor diligence, expertise,
exit/unwind (honor certificates off-chain if network fails). Document
de-tokenization and pure core servicing fallback.

## 9. Accounting notes (high level — confirm with accountants)

| Party | Possible treatment (discuss) |
| --- | --- |
| Issuer | CD liability until closed; settlement payable to redeemer |
| Redeemer | Cash out / member deposit liability; receivable from issuer until settled |
| Operator | Fee revenue; no deposit liability |

## 10. Recommended pre-pilot checklist

- [ ] Counsel memo on product characterization and network agency model  
- [ ] BSA program update + training  
- [ ] Board resolution / risk appetite limits  
- [ ] Bilateral MOU executed  
- [ ] Member addendum live for pilot certificates  
- [ ] Tabletop: double presentment, false ID, lost keys, late settlement  
- [ ] Cyber runbook for oracle/settlement keys  
- [ ] Marketing review (Part 740 / UDAAP)  
- [ ] NCUA engagement plan (timing per counsel)  

## 11. Conclusion

The settlement network is **feasible as a correspondent burn-and-settle
design** if contracts, BSA ownership, burn uniqueness, and liquidity caps are
treated as first-class controls. Technology already demonstrates claim lookup
and presentment UX; **legal and operational readiness**—not smart contracts
alone—gate real-member cash-out at arbitrary CUs.

---

**References:** docs/compliance.md; docs/network/business-proposal.md;
NCUA LCU 22-CU-07; 21-CU-16; 12 CFR Parts 740, 745, 748.
