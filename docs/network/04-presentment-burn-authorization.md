# 04 — Presentment & Burn Authorization Form

**Document type:** Transaction authorization (paper or e-sign capture)  
**Used by:** Redeeming credit union desk / digital flow  
**Retain:** Per BSA and network retention schedule  

---

## Presentment & Burn Authorization

**Redeeming Credit Union:** ________________________________  
**Branch / channel:** ________________________________  
**Date/time:** ________________________________  
**Teller / officer:** ________________________________  

### A. Holder / walk-in

| Field | Value |
| --- | --- |
| Legal name | |
| Address | |
| DOB | |
| ID type / number / expiration | |
| CIP method | [ ] Doc + non-doc  [ ] Existing member  [ ] Other: ______ |
| OFAC screened | [ ] Yes — time ______  result: clear / escalate |
| Phone / email | |

### B. Certificate / CDT claim

| Field | Value |
| --- | --- |
| Issuing credit union | |
| Deposit ID (asset name) | |
| Transaction / reference # | |
| Product / term | |
| Principal | $ |
| Quoted cash-out mode | [ ] Mature  [ ] Early withdrawal |
| Quoted cash-out amount | $ |
| SettlementAuth ID (if any) | |
| SettlementAuth expires | |

### C. Disbursement

| Field | Value |
| --- | --- |
| Method | [ ] Credit to share/draft # ______  [ ] Cash  [ ] Official check |
| Account name matches walk-in | [ ] Yes  [ ] No — explain: ______ |
| Hold applied | [ ] None  [ ] Until burn confirmed  [ ] Other: ______ |

### D. Holder authorization (read carefully)

I am the owner (or authorized representative) of the share certificate
referenced above at the **Issuing Credit Union**. I request cash-out through
this **Redeeming Credit Union** under the CDT Settlement Network rules.

I understand and agree that:

1. My **deposit is at the Issuing Credit Union** and is insured by the NCUA
   only as described in that institution’s disclosures; **the CDT token is not
   insured**.  
2. Cash-out before maturity may apply the **early-withdrawal penalty** in my
   certificate terms.  
3. I authorize **destruction (burn)** of the CDT / digital receipt so this
   certificate cannot be paid again.  
4. I authorize the Issuing Credit Union to settle the cash-out amount to the
   Redeeming Credit Union and to close the certificate on its books when
   appropriate.  
5. I will complete any wallet signature or recovery steps required to effect
   the burn.  
6. Providing false identification is a crime and may be reported.

**Wallet / signature proof:**  
[ ] Device signature challenge captured  ref: __________  
[ ] Recovery letter from Issuer attached  
[ ] Other: __________

**Holder signature:** ______________________________ **Date:** __________  

**Printed name:** ______________________________  

**If representative:** capacity __________ ; documents reviewed __________  

### E. Redeeming CU certification

I certify CIP/OFAC were performed under our procedures; claim quote matches
Issuer response; disbursement follows our pilot finality policy.

**Officer signature:** ______________________________ **Date:** __________  

### F. Post-transaction (ops)

| Step | Initials / time |
| --- | --- |
| PresentmentRequest submitted | |
| SettlementAuth received | |
| Disbursement posted | |
| Burn tx hash | `                                ` |
| BurnEvidence accepted by Issuer | |
| Settlement received from Issuer | |
| Presentment closed | |

---

**Form ID:** CDT-PBA-001 · **Version:** 0.1
