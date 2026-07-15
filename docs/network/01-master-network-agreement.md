# 01 — Master Network Agreement (Term Sheet / Outline)

**Document type:** Term sheet for counsel to draft definitive agreements  
**Parties (conceptual):** Network Operator; Issuing Institutions; Redeeming Institutions  
**Status:** Outline only — not an executable contract  
**Related:** [Business proposal](./business-proposal.md) · [Bilateral MOU](./02-bilateral-mou.md)

---

> Counsel must draft jurisdiction-specific agreements. This outline identifies
> commercial and risk terms the CDT Settlement Network expects to negotiate.

## 1. Recitals

- Issuers offer share certificates that may be evidenced by CDTs.  
- Redeemers wish to present CDTs for cash-out of holders.  
- Network provides messaging, standards, and optional technology services.  
- Insured deposit liabilities remain on Issuer’s books until paid and closed.

## 2. Definitions (selected)

| Term | Meaning |
| --- | --- |
| CDT | Native asset receipt minted under Issuer’s program |
| Claim | Issuer core record bound to `deposit_id` |
| Presentment | Redeemer request to cash out a Claim for a Holder |
| SettlementAuth | Issuer-signed authorization for a Presentment (TTL) |
| BurnEvidence | On-chain tx proving CDT burn under vault rules (or Issuer cancel proof) |
| Cash-Out Amount | Mature or early formula per original product terms |
| Network Messages | Schema in [05-messaging-protocol](./05-messaging-protocol.md) |

## 3. Admission & roles

- **Issuing Institution:** mints CDTs; responds to lookup/presentment; settles.  
- **Redeeming Institution:** CIP of walk-in; may advance/credit; submits burn evidence.  
- **Network Operator:** directory, message hub, audit logs, fee collection (if any).  
- Admission criteria: FICU (or agreed charter types), BSA program, signed joinder.

## 4. Presentment rights & duties

### 4.1 Redeemer duties

- Perform CIP/OFAC on the presenting person.  
- Verify ownership (wallet challenge or Issuer recovery letter).  
- Submit PresentmentRequest only for live Claims.  
- Not release **unrestricted** funds contrary to agreed finality policy
  (e.g., hold until BurnEvidence, or credit within advance caps).  
- Submit BurnEvidence within agreed window.

### 4.2 Issuer duties

- Maintain accurate Claim data and unique presentment registry.  
- Respond to ClaimLookup within SLA.  
- Issue or refuse SettlementAuth with reason codes.  
- Accept unique BurnEvidence; close certificate; settle Cash-Out Amount
  (net of fees) within settlement SLA.  
- Refuse double presentment after settlement/close.

### 4.3 Network Operator duties

- Uptime SLA for hub (if centralized).  
- Key directory and certificate pinning for institution endpoints.  
- Retain message logs for audit period (e.g., 7 years or BSA requirement).  
- Incident notification.

## 5. Burn-and-settle covenant (core commercial term)

> Issuer’s obligation to pay Redeemer is **conditioned on** (i) a valid
> SettlementAuth for that Presentment and (ii) unique BurnEvidence (or Issuer
> cancel) for the `deposit_id`, such that the Claim cannot be paid again.

Optional: Issuer may prefund a settlement account at Operator for T+0 netting.

## 6. Settlement

- Default rail: ACH credit to Redeemer’s designated account.  
- Optional: Fedwire for large items above threshold.  
- Netting: optional multilateral net settlement if Operator provides.  
- Failed settlement: interest on late amounts; suspension rights.

## 7. Fees

- Per [fee schedule](./07-fee-schedule.md), updated by schedule amendment.  
- Issuer typically pays presentment fee (or split).  
- Operator subscription and message fees.

## 8. Risk allocation

| Loss type | Primary bearer (default draft) |
| --- | --- |
| Redeemer pays wrong person despite bad CIP | Redeemer |
| Issuer double-pays same deposit_id | Issuer |
| Hub outage delaying settlement | Operator SLA credits; no consequential damages cap carve-outs TBD |
| Oracle key compromise (Issuer-side) | Issuer (+ cyber insurance) |
| On-chain congestion delay | Shared; no breach if evidence submitted timely |

Fraud indemnity and insurance minimums to be negotiated.

## 9. Compliance

- Each party remains responsible for its own BSA/AML, OFAC, privacy, and
  consumer compliance.  
- Cross-sharing of NPI only under GLBA service-provider / permitted basis
  with contracts limiting reuse.  
- No party shall market CDT as “NCUA-insured crypto.”  
- Disclosures: deposit insured at Issuer; token not insured.

## 10. Data & privacy

- Minimum data principle for PresentmentRequest (prefer hashes of ID docs).  
- Encryption in transit; access controls; retention schedule.  
- Breach notification timelines.

## 11. Intellectual property & branding

- CDT marks licensed for network use.  
- No implication of NCUA endorsement.

## 12. Term, suspension, termination

- Term: 1–3 years auto-renew.  
- Suspension for BSA failures, unpaid settlements, security incidents.  
- Exit: complete open presentments; return or destroy data.

## 13. Dispute resolution

- Good-faith escalation → mediation → arbitration (or court) as counsel advises.  
- Governing law: e.g., Delaware or Florida (TBD).

## 14. Joinder

- New institutions join via Joinder Agreement incorporating this Master + fee schedule.

## 15. Exhibits (to attach in definitive docs)

- A: Messaging protocol  
- B: Fee schedule  
- C: Operating procedures  
- D: Insurance requirements  
- E: Service levels  
- F: Approved product types / max certificate size  

---

**End of term sheet outline.**
