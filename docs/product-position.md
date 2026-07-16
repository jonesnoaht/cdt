# Product position: CU login → credit-claim CDT → browser wallet (Lace)

**Status:** Canonical product position (July 2026) — **credit-claim primary**  
**Design:** [superpowers/specs/2026-07-16-cdt-credit-claim-design.md](./superpowers/specs/2026-07-16-cdt-credit-claim-design.md)  
**Related:** [manual.md](./manual.md) · [whitepaper.md](./whitepaper.md) · CIP-30 Lace · webapp `#/facility`, `#/facility-present`

---

## The position (primary)

**A member opens a pledged share certificate and a secured line of credit against it. CDT minted into their wallet equals available credit. They keep the certificate coupon. Others can hold and spend CDT; cash-out draws the original depositor’s LOC — not a partial close of the CD.**

| Step | Who | What |
| --- | --- | --- |
| 1 | Member | Authenticates to the **credit union** (desk / online banking) |
| 2 | Member + CU | Opens **CD** (coupon to depositor) + **secured LOC** (LTV e.g. 90%) |
| 3 | Oracle + mint | Mints **bearer CDT = available credit** to member wallet |
| 4 | Commerce | Free-spend transfers; presenter cash-out runs **CIP/OFAC** then draws **depositor LOC** and burns CDT |
| 5 | Maturity | **Waterfall** (LOC → CDT face → residual to depositor); optional **re-issue** only with dual opt-in |

Legacy path (`#/open` vault interest redeem) remains for demos but is **not** the primary product.

The **deposit stays on the CU books** as the pledged certificate. CDT is a portable claim on **credit capacity**, not “the deposit itself,” and is **not** NCUSIF-insured.

---

## Why this wording matters

1. **CU is the front door.** Login is membership banking, not MetaMask-only onboarding.
2. **Buy = tokenize a CD**, not “buy a coin.” Language on desks and marketing must stay deposit-accurate.
3. **Browser wallet is the delivery surface.** Members already expect assets to appear in Lace/Eternl; CDT should meet them there.
4. **Lace is the reference wallet.** CIP-30 integration (`window.cardano.lace`) is first-class; other CIP-30 wallets remain compatible.
5. **Free-spend + optional payment check.** Once delivered, CDT may transfer under the free-spend paradigm; merchants may still require `cdt.payment_check.v1`.

---

## UX story (member-facing)

```text
Member opens CU digital banking / issuer desk (#/open)
        │
        ▼
  Authenticated session (member selected / SSO later)
        │
        ▼
  Connect Lace (CIP-30) — confirm destination wallet
        │
        ▼
  CIP checklist · choose product · amount · disclosures
        │
        ▼
  Book CD on core  →  oracle attests  →  mint CDT
        │
        ▼
  Certificate bound to Lace-controlled keys
  (member sees claim / can sign redeem-burn in Lace)
```

Teller/ops copy (issuer desk):

> “We’ll open the certificate on our core, then put the digital certificate under the member’s Lace wallet so they can prove ownership and redeem without calling us for every verification.”

---

## Technical mapping (prototype today)

| Product sentence | Prototype reality |
| --- | --- |
| Log into CU account | Member picker / session on webapp (`#/open`); production = CU SSO / core session |
| Buy CDT | Book `cd_funding` deposit → oracle VC gate → mint |
| Into browser wallet | **Owner** payment key / address from Lace CIP-30; redeem/burn signed in Lace (`#/sign`) |
| Token location | Vault locks principal + interest with CDT asset name = deposit id; **control** is the member’s keys (Lace). Free-spend transfers and “balance visible in Lace as a native asset” remain product/engineering alignment goals where not yet identical to vault UTxO UX |

Honest constraint: examiners and members must still understand **NCUSIF covers the deposit on the issuer’s books**, not a token balance in a wallet app.

---

## Engineering checklist

- [x] CIP-30 Lace connect + `signTx` for redeem/burn (`webapp/src/ui/cip30.ts`, `#/sign`)
- [x] Tokenize wizard: connect Lace / confirm destination wallet (`#/open`)
- [x] Product position documented (this file)
- [ ] Production CU SSO / core session (not demo member picker)
- [ ] Optional mint path that surfaces CDT unit in Lace asset list when product policy allows free-held claim tokens
- [ ] Deep-link “Open in Lace” after mint confirmation

---

## What we do **not** claim

- That Lace or any wallet is a bank or NCUA-insured
- That transferring CDT transfers NCUSIF coverage
- That CIP checkboxes in the demo are production CIP systems
- That unauthenticated public minting is allowed

---

## One-line pitch

**Log into your credit union. Buy a CD. Hold the certificate in Lace.**
