# 02 — Bilateral Pilot Memorandum of Understanding

**Document type:** Non-binding / partially binding pilot MOU template  
**Parties:**

- **Issuer:** _________________ Credit Union (“Issuer”)  
- **Redeemer:** _________________ Credit Union (“Redeemer”)  
- **Technology partner (optional):** CDT Labs / project team (“Operator”)

**Status:** Template for negotiation — execute only after counsel review  
**Pilot name:** CDT Settlement Pilot — [Year]

---

> This MOU may be structured as non-binding on commercial expansion while
> binding on confidentiality, data use, and pilot cost allocation. Counsel
> should mark binding vs non-binding sections explicitly.

## 1. Purpose

Issuer and Redeemer will pilot multi-institution cash-out of Certificate of
Deposit Tokens (CDTs): Redeemer may present eligible CDTs to Issuer; after
verification and burn (or cancel), Issuer settles the Cash-Out Amount to
Redeemer so Redeemer can credit or has credited the holder.

## 2. Pilot scope

| Item | Pilot parameter |
| --- | --- |
| Duration | __ months from Effective Date |
| Max live certificates | __ (Issuer) |
| Max presentment notional outstanding | $________ (Redeemer advance cap) |
| Max single presentment | $________ |
| Settlement rail | ACH to Redeemer ABA/account: ________ |
| Settlement SLA | T+__ business days after accepted BurnEvidence |
| Environments | [ ] testnet only  [ ] limited production |
| Public marketing | [ ] none  [ ] limited staff  [ ] members by invite |

## 3. Roles

**Issuer shall:**

- Maintain core records for pilot CDs and unique presentment registry.  
- Provide ClaimLookup and SettlementAuth (API or agreed portal).  
- Process BurnEvidence and settle within SLA.  
- Update member terms for network presentment ([03](./03-member-terms-addendum.md)).  

**Redeemer shall:**

- Perform CIP/OFAC on presenting persons.  
- Follow operating procedures ([06](./06-operating-procedures.md)).  
- Not exceed advance caps; apply hold policy if agreed.  
- Submit PresentmentRequest and BurnEvidence timely.  

**Operator shall (if party):**

- Provide software, training, and message logging.  
- Support tabletop exercises and incident response.

## 4. Process (binding process description)

The parties will follow the message flow in
[05-messaging-protocol](./05-messaging-protocol.md): Lookup → Presentment →
SettlementAuth → Credit/Cash → BurnEvidence → SettlementPayment.

Holder authorization will use
[04-presentment-burn-authorization](./04-presentment-burn-authorization.md)
or equivalent e-sign capture.

## 5. Fees (pilot)

| Fee | Amount | Payer |
| --- | --- | --- |
| Pilot setup | $________ | ________ |
| Per presentment | $________ | ________ |
| Failed/cancelled presentment | $________ | ________ |

Or: “waived during pilot.”

## 6. Risk & finality policy (choose one)

**Option A — Hold until burn:** Redeemer posts credit with hold; releases after
Issuer accepts BurnEvidence.  

**Option B — Advance with cap:** Redeemer may advance up to daily cap after
SettlementAuth; Issuer prioritizes settlement; Redeemer bears misidentification
risk.  

**Option C — Issuer pays member:** Redeemer verifies only; Issuer ACHs member;
no Redeemer advance.

Pilot selection: **Option ____**

## 7. Compliance

- Each party’s BSA officer signs off before live presentments.  
- Insurance disclosures per compliance memo; no “insured token” marketing.  
- GLBA: limit NPI sharing to presentment need-to-know.  
- Cyber incidents: notify other party within __ hours.

## 8. Confidentiality

Mutual NDA terms for __ years; carve-outs for regulators and legal process.

## 9. Intellectual property

Pilot does not transfer IP. Operator grants limited license to use pilot
software. Feedback may be used to improve the product.

## 10. Term and termination

- Effective Date: ________  
- Either party may terminate for convenience with __ days’ notice.  
- Open presentments must be completed or unwound in good faith.

## 11. Non-binding expansion

Nothing obligates parties to join a multilateral Master Network Agreement.
Pilot results will inform a go/no-go for expansion.

## 12. Governing law

State of ________ .

## 13. Signatures

| | Issuer | Redeemer | Operator (optional) |
| --- | --- | --- | --- |
| Name | | | |
| Title | | | |
| Date | | | |
| Signature | | | |

---

## Exhibit A — Contacts

| Function | Issuer | Redeemer |
| --- | --- | --- |
| Executive sponsor | | |
| BSA / OFAC | | |
| Treasury / settlement | | |
| IT / security | | |
| Ops desk | | |

## Exhibit B — Test certificates

List of deposit_ids / product types approved for pilot.
