# 06 — Operating Procedures (Settlement Network)

**Document type:** Ops runbook  
**Audience:** Teller supervisors, BSA, treasury, IT ops  
**Version:** 0.1  

---

## 1. Daily readiness (Redeeming CU)

- [ ] Settlement account balances sufficient for expected advances (if Option B).  
- [ ] OFAC list update completed per BSA schedule.  
- [ ] Network API health green / portal reachable.  
- [ ] Dual-control staff available for large presentments (threshold $____).  
- [ ] Fee and limit table current.

## 2. Daily readiness (Issuing CU)

- [ ] Oracle / attestation service healthy.  
- [ ] Presentment API healthy.  
- [ ] Settlement funding account ready for ACH.  
- [ ] Exception queue reviewed (expired auths, stuck burns).  
- [ ] Reconciliation prior day: presentments vs core closes vs ACH.

## 3. Teller procedure — redeem foreign CDT

### 3.1 Identify

1. Collect government ID; run CIP per policy (new or existing member).  
2. OFAC screen walk-in; escalate hits—do not proceed.  
3. Obtain deposit_id / CDT reference from member (wallet display or paper).  

### 3.2 Lookup

1. Submit ClaimLookup.  
2. If not found / closed / pending → **refuse** and explain.  
3. Confirm quoted name matches ID (allow minor formatting differences per policy).  
4. Explain mature vs early cash-out and penalty if early.  
5. Member accepts quote → complete [Presentment & Burn Authorization](./04-presentment-burn-authorization.md).

### 3.3 Authorize

1. File PresentmentRequest.  
2. Receive SettlementAuth; **verify issuer signature** and expiry.  
3. If auth missing/expired → stop.

### 3.4 Disburse (per pilot finality option)

**Hold-until-burn:** post credit with hold; proceed to burn; release hold on
BurnAccepted.  

**Advance-with-cap:** check daily cap; post credit/cash; proceed to burn
immediately.  

**Issuer-pays-member:** do not disburse; wait for issuer ACH to member.

### 3.5 Burn

1. Guide member through wallet redeem/early-withdraw (or issuer-assisted).  
2. Capture tx_hash.  
3. Submit BurnEvidence.  
4. On BurnRejected: freeze disbursement / reverse if possible; open case.

### 3.6 Close

1. On SettlementPayment: match amount; clear receivable.  
2. File SAR if suspicious (structuring, false ID, mule patterns).  
3. Retain forms per retention schedule.

## 4. Issuer procedure — process presentment

1. Validate redeemer is admitted / not suspended.  
2. Re-load claim; ensure not closed and no open presentment conflict.  
3. Recompute cash-out; if differs > $0.01 from request → reject AMOUNT_MISMATCH.  
4. Optional: secondary fraud rules (velocity, geo).  
5. Issue SettlementAuth (signed, TTL).  
6. On BurnEvidence: verify chain; close CD on core; block re-presentment.  
7. Initiate ACH/wire; emit SettlementPayment.  
8. Reconcile end of day.

## 5. Exception playbooks

| Event | Action |
| --- | --- |
| Member abandons after credit, before burn | Contact member; if no burn in T+__, reverse credit or escalate recovery |
| Burn succeeded, settlement late | Treasury escalates; Redeemer may suspend new advances |
| Suspected stolen wallet | Freeze presentment; Issuer recovery path; law enforcement as needed |
| OFAC true match | Do not transact; escalate BSA; document |
| Hub / chain outage | Pause new presentments; queue existing per SLA |

## 6. Reconciliation (daily)

**Issuer files:**

- Presentments authorized / settled / rejected counts.  
- Core certificates closed vs BurnAccepted.  
- ACH outflows vs SettlementPayment messages.  

**Redeemer files:**

- Credits posted vs SettlementPayment received.  
- Aged receivables > SLA.  
- Cap utilization.

Breaks → same-day investigation ticket between treasury desks.

## 7. Training

- Annual BSA training includes presentment scenarios.  
- New tellers: supervised presentments until sign-off.  
- Tabletop quarterly: double presentment, lost keys, false ID.

## 8. Record retention

- Presentment forms, auth payloads, burn hashes, settlement traces: minimum
  **5 years** or longer if BSA/state requires.  
- Video/ID images: per existing CIP media policy.

## 9. Customer communication scripts (short)

**Insurance:**  
“Your certificate deposit is insured at the *issuing* credit union up to NCUA
limits. The digital token is a record—not an insured deposit here.”

**Early:**  
“Cashing out before maturity applies the early-withdrawal penalty in your
original disclosures. Here’s the net amount.”

**Burn:**  
“We destroy the digital receipt when we cash this out so it can’t be paid
twice—like punching a paper certificate.”
