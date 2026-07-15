# 07 — Fee Schedule (Draft)

**Document type:** Commercial exhibit  
**Version:** 0.1  
**Status:** Illustrative assumptions for pilot negotiation — not a quote  

---

## 1. Principles

- Keep member-facing certificate economics unchanged except disclosed early
  penalties.  
- Prefer **institution-paid** network fees over surprising member fees.  
- Align fees with cost of liquidity risk (redeemer) and ops (issuer/operator).

## 2. Pilot (bilateral) — suggested defaults

| Fee | Amount | Payer | Notes |
| --- | --- | --- | --- |
| Pilot setup / integration | $0 – $50,000 | Split or Issuer | Waive if strategic design partner |
| Monthly platform (Issuer) | $0 during pilot | — | Start month 4 optional |
| Presentment success | $10 flat | Issuer | Per settled presentment |
| Presentment success (alt) | 5 bps of cash-out | Issuer | Cap $100 / floor $5 |
| Rejected after auth | $2 | Redeemer | Discourage spam auths |
| Wire surcharge (if used) | Pass-through | Issuer | Above ACH threshold |

## 3. Network (multilateral) — illustrative

| Fee | Amount | Payer |
| --- | --- | --- |
| Annual membership | $2,500 – $15,000 / CU | Each participant |
| Issuer SaaS | $3,000 – $12,000 / month | Issuer |
| Presentment | $8–$25 + 0–10 bps | Issuer (default) |
| Redeemer acquisition credit | $5 / new member funded | Network promo optional |
| Premium same-day settlement | +$15 | Issuer or Redeemer |

## 4. Member fees

**Default recommendation:** $0 network fee to member.  
Early-withdrawal penalty remains solely as in Truth in Savings disclosure.

If a member fee is ever charged, it must be separately disclosed and not
conflated with NCUA insurance or “crypto gas” without clarity.

## 5. Settlement amount definition

```
Cash-Out Amount = mature_payout  OR  early_payout   (per product math)
Settlement to Redeemer = Cash-Out Amount − Issuer_presentment_fee
                         (+/− agreed adjustments)
```

On-chain vault may pay holder in lovelace under demo peg; **production
network settlement is fiat** between CUs regardless of chain units.

## 6. Invoicing

- Operator invoices monthly in arrears.  
- ACH pull authorized under membership agreement.  
- Dispute window: 15 days.

## 7. Changes

Fee schedule amendments require __ days’ notice; material increases allow
termination for convenience without penalty.

---

**This schedule is a negotiation starter, not a binding price list.**
