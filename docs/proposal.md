# Certificate of Deposit Token (CDT) — Business Proposal

**Author:** Noah Jones
**Status:** Working draft — prototype stage
**Audience:** Credit union leadership (prepared with CampusUSA Credit Union, Gainesville, FL, in mind), partners, and technical reviewers

> **Important disclaimer.** The CDT is a technology prototype running on Cardano
> test networks with a simulated bank ledger. It is **not** an offer to sell
> securities, deposits, or any financial product, and nothing in this document
> is investment, legal, accounting, or tax advice. Any production deployment
> would proceed only with the issuing institution's board approval, legal
> counsel, and the applicable regulators (NCUA and, where relevant, state
> supervisors) engaged from the outset.

## 1. Executive summary

The Certificate of Deposit Token (CDT) lets a credit union issue an ordinary
certificate of deposit (share certificate) whose *contract* —
principal, rate, term, and early-withdrawal penalty — is represented by a
digital token on the Cardano blockchain. The member's money never leaves the
credit union: the deposit sits in an insured CD funding account exactly as it
does today. What changes is the *record*: instead of a paper certificate and a
core-banking entry that only the institution can see, the member holds a
cryptographically verifiable token whose terms are locked in an on-chain vault
contract and whose issuance was co-signed by an oracle that verified both the
deposit and the member's credentials.

The idea has a concrete origin: in July 2021 the author first raised the
concept with CampusUSA Credit Union in Gainesville, Florida, in an informal,
in-person conversation. The feedback was enthusiastic — the credit union had
not yet begun any digital-asset initiative and asked the author to return
with a working demonstration. That demonstration now exists as a
working prototype (Section 6), and this proposal outlines a scoped pilot to
take it from prototype to a limited member beta (Section 7).

The timing is favorable. The US regulatory posture toward tokenized bank
products shifted materially in 2025–2026. The
[GENIUS Act](https://kpmg.com/us/en/articles/2026/genius-act-fdic-ncua-occ-proposals-for-applications-prudential-frameworks-reg-alert.html)
(signed July 2025) is a payment-stablecoin statute — it does not govern CDs —
but it made the NCUA a named digital-asset regulator, and its implementing
wave reaches further: the
[FDIC's April 2026 proposed rulemaking](https://www.federalregister.gov/documents/2026/04/10/2026-06974/genius-act-requirements-and-standards-for-fdic-supervised-permitted-payment-stablecoin-issuers-and)
explicitly addresses **tokenized deposits** and affirms that deposit insurance
"does not depend upon the technology or recordkeeping used to record" deposit
liabilities, and the [NCUA has issued parallel proposals](https://www.cullenllp.com/blog/what-credit-unions-need-to-know-about-the-genius-act-and-ncua-proposed-rules/)
for federally insured credit unions. Tokenized recordkeeping for a deposit
product is no longer a regulatory unknown; it is an activity regulators are
actively writing rules for.

## 2. The problem

**CDs are illiquid and paper-bound.** A certificate of deposit is one of the
safest instruments a household can hold, yet it is administered like it is
1975: a paper certificate or a line in a statement, redeemable only at the
issuing institution, transferable only through cumbersome retitling, and
opaque to everyone except the issuer. A member who needs cash before maturity
has exactly one option — break the CD and pay the penalty — because there is
no practical way to evidence, price, or transfer the contract.

**CDs are non-portable.** The certificate cannot follow the member. It cannot
be verified by a third party (a lender evaluating collateral, an estate
executor, an auditor) without contacting the institution and waiting for
manual confirmation.

**Credit unions lack a safe digital-asset on-ramp.** Members — especially
younger members — increasingly expect digital-native financial products, and
some are moving savings to crypto platforms with no insurance and no
supervision. Credit unions have largely had no answer: speculative crypto
custody is a poor fit for the movement's risk culture, but doing nothing cedes
the demographic. What has been missing is a product that is digital-native in
form while remaining a plain insured deposit in substance.

**Servicing is manual.** Rate accrual, maturity notices, penalty calculation,
and audit evidence are all handled by core-banking batch processes and human
reconciliation. Every step is a cost and an error surface.

## 3. The solution: the CDT lifecycle in business terms

The CDT does not move money onto a blockchain. It moves the *evidence of the
contract* onto a blockchain, while the money stays where it belongs — in the
insured institution. The lifecycle:

1. **Deposit.** The member deposits funds into a dedicated CD funding account
   at the credit union. This is a normal, insured deposit. Nothing about the
   member's money is ever held by a third party or a smart contract.
2. **Verification.** An oracle watcher — software operated by or for the
   credit union — independently verifies two things before anything is
   issued: (a) the deposit actually landed in the funding account, by reading
   the bank's own ledger; and (b) the member is who they claim to be, by
   checking a chain of verifiable credentials that runs from the regulator
   (NCUA) to the credit union to the member. Existing KYC is not bypassed; it
   is *encoded*.
3. **Co-signed issuance.** Only when both checks pass does the oracle co-sign
   the minting transaction. A CDT — a Cardano native asset — is minted with
   the CD's terms (principal, rate, start date, maturity date,
   early-withdrawal penalty) bound to it, and it is locked at an on-chain
   vault contract that also holds the tokens representing principal and
   interest entitlement.
4. **Holding.** The member (and anyone the member authorizes) can verify the
   CD's existence and terms at any time, cryptographically, without calling
   the credit union. The credit union's auditors and examiners can do the
   same.
5. **Redemption.** At maturity, the member redeems the token and the vault
   contract releases the full entitlement — principal plus interest —
   triggering payout from the credit union. Before maturity, the same
   contract enforces the early-withdrawal penalty automatically: the terms
   are code, so servicing is deterministic rather than manual.

Three properties matter to a financial institution:

- **The deposit never leaves the insured institution.** The token represents
  the contract, not custody of the funds. Insurance analysis is unchanged in
  substance — consistent with the FDIC's technology-neutral position on
  tokenized deposits in its [April 2026 proposed rule](https://www.fdic.gov/news/financial-institution-letters/2026/notice-proposed-rulemaking-establish-genius-act).
- **Issuance is credential-gated.** No CDT can exist without the oracle's
  co-signature, and the oracle will not sign without a verified deposit and a
  verified member credential chain. KYC/BSA controls are preserved by
  construction, not by policy.
- **Terms are locked and self-enforcing.** The rate, maturity, and penalty
  live in the contract. Neither party can misremember or misapply them.

## 4. Value proposition by stakeholder

### For the member

- **Transparency.** The member holds independent, verifiable proof of the
  CD's existence and exact terms — no statement lag, no "call us to confirm."
- **Portability.** The certificate is a digital object the member controls
  and can present to third parties (lenders, executors, accountants) who can
  verify it instantly.
- **Potential secondary liquidity.** Because the contract is a transferable
  token, a future, properly regulated marketplace could let a member sell a
  CD before maturity instead of breaking it — turning the penalty from the
  only exit into the worst-case exit. (This is a roadmap possibility, not a
  pilot feature; any transferability would be enabled only within the
  credential-gated membership and with regulatory sign-off.)

### For the credit union

- **Product differentiation.** First-mover positioning among the roughly
  [4,300 federally insured credit unions](https://ncua.gov/newsroom/press-release/2026/ncua-releases-fourth-quarter-2025-credit-union-system-performance-data)
  with a product no fintech can honestly copy: digital-native *and* insured.
- **Younger demographics.** A credible answer to members drifting toward
  uninsured crypto platforms: the digital experience they expect, on a
  balance sheet the credit union already knows how to manage.
- **Automated servicing.** Penalty computation, maturity handling, and term
  disputes shrink toward zero because the contract enforces itself; the
  oracle watcher doubles as a continuous reconciliation agent between the
  core ledger and the on-chain record.
- **Deposit growth.** CD balances industry-wide roughly doubled from their
  2021 trough as rates rose (see Section 5); a differentiated certificate
  product competes for exactly those dollars.

### For the regulator and examiner

- **Full auditability.** Every issuance, term, and redemption is an
  append-only, timestamped record that an examiner can verify independently
  of the institution's own systems.
- **Cryptographic attestation trail.** The NCUA → credit union → member
  credential chain means every token carries proof of *who* authorized it and
  *under what authority* — a materially stronger evidence standard than
  today's paper trail.
- **No new custody risk.** Funds remain in the supervised institution; the
  examiner's insurance and safety-and-soundness analysis is not displaced by
  the technology, which aligns with the technology-neutral direction of the
  [FDIC's 2026 tokenized-deposit proposal](https://www.fdic.gov/news/financial-institution-letters/2026/notice-proposed-rulemaking-establish-genius-act)
  ([press overview](https://www.forbes.com/sites/jasonbrett/2026/04/07/fdic-advances-major-framework-for-stablecoins-and-tokenized-deposits/))
  and the NCUA's parallel rulemaking.

## 5. Market context

- **CDs are a large, growing product.** Outstanding CD balances at
  FDIC-insured institutions exceeded **$2.1 trillion by Q3 2025**, roughly
  double their 2021 trough of about $1.1 trillion, as higher rates pulled
  savers back into time deposits ([Mark Spark Solutions market analysis](https://marksparksolutions.com/reports/us-certificate-of-deposit-market);
  see also [Verified Market Research](https://www.verifiedmarketresearch.com/product/us-certificate-of-deposit-market/)).
- **The credit-union sector is substantial.** As of Q4 2025, federally
  insured credit unions held **$2.43 trillion in assets** and served **144.7
  million members** across **4,287 institutions**
  ([NCUA Q4 2025 data](https://ncua.gov/newsroom/press-release/2026/ncua-releases-fourth-quarter-2025-credit-union-system-performance-data)).
  Share certificates are a core savings product across the sector.
- **Real-world-asset tokenization is the fastest-growing segment of digital
  assets.** On-chain RWA value grew almost fivefold in three years to
  [$24 billion by mid-2025](https://www.coindesk.com/business/2025/06/26/real-world-asset-tokenization-market-has-grown-almost-fivefold-in-3-years)
  and reached roughly
  [$31 billion by mid-2026](https://yellow.com/research/tokenized-rwas-31b-market-growth-real-race-starting).
  Institutional forecasts range from McKinsey's ~$2 trillion by 2030 to
  Standard Chartered's $30 trillion by 2034
  ([overview](https://investax.io/blog/real-world-asset-tokenization-trends-and-outlook-for-2026)).
  Tokenized *deposit products* are the natural next category: they are the
  simplest RWA there is — a claim on an insured institution.
- **The rules are being written now.** The GENIUS Act (signed July 18, 2025)
  directed the OCC, Federal Reserve, FDIC, **and NCUA** to build licensing
  and supervision frameworks, with final rules due by July 18, 2026
  ([KPMG regulatory alert](https://kpmg.com/us/en/articles/2026/genius-act-fdic-ncua-occ-proposals-for-applications-prudential-frameworks-reg-alert.html)).
  Institutions that have run controlled pilots will be the ones positioned to
  act when the frameworks finalize.

Figures above are third-party estimates gathered in July 2026 and should be
re-verified before inclusion in any board-level or regulatory filing.

## 6. Product description: what the demo shows today

**This is a prototype.** It runs against Cardano test networks with a
simulated bank ledger and mock credentials. It has processed no real money
and no real member data. What it demonstrates, end to end:

- **On-chain contracts (Aiken / Plutus V3).** A vault validator holds the
  principal-and-interest entitlement and enforces the CD terms — release in
  full at maturity, release minus the early-withdrawal penalty before
  maturity. A minting policy ensures a CDT can only be created with the
  oracle's co-signature.
- **Oracle watcher (TypeScript + Lucid Evolution).** A service that watches
  the simulated bank database (Postgres) for qualifying deposits into the CD
  funding account, verifies the member's credential chain, and co-signs the
  mint only when both checks pass.
- **Bank simulation (Postgres).** A stand-in for the credit union's core
  ledger, modeling the CD funding account and deposit events. In production
  this becomes a read-only integration with the actual core system.
- **Identity (mock DID/VC).** A mocked verifiable-credential chain modeling
  NCUA → credit union → member trust. The production path is
  [Hyperledger Identus](https://www.lfdecentralizedtrust.org/projects/identus),
  a Linux Foundation Decentralized Trust project that uses Cardano as its
  verifiable data registry.
- **Full lifecycle.** Deposit → verification → co-signed mint → vault lock →
  redemption at maturity or early with penalty, all scripted and repeatable.

What the demo deliberately does **not** include yet: real core-banking
integration, production credential issuance, member-facing UI hardening,
custody/key-management policy, and the compliance program a live pilot
requires. These are the pilot's work items, not afterthoughts — they are
treated in the companion architecture, compliance, feasibility, and rollout
documents prepared alongside this proposal in the `docs/` series.

## 7. Pilot proposal for CampusUSA

A two-phase pilot, each phase gated on an explicit go/no-go review with
CampusUSA leadership and counsel.

### Phase 1 — Internal testnet pilot (approx. 3–4 months)

- Deploy the full stack against Cardano's public testnet with CampusUSA
  staff acting as members; no member funds, no production data.
- Replace the Postgres simulation with a **read-only** feed from a staging
  copy of the core banking system.
- Stand up a real Identus credential-issuance flow for the
  NCUA → CampusUSA → member chain (with the NCUA credential still
  simulated, pending regulator participation).
- Deliverables: operational runbook, security review, internal audit
  walkthrough demonstrating the examiner-facing attestation trail, and a
  go/no-go report.

### Phase 2 — Limited member beta (approx. 4–6 months, contingent on Phase 1)

- Invite a small, capped cohort of consenting members (for example, 25–100
  members, low certificate minimums, aggregate exposure capped) to open real
  share certificates recorded via CDT in parallel with — not in replacement
  of — the core system of record.
- The core banking system remains the legal system of record throughout the
  beta; the CDT layer runs in "shadow" mode, so the core ledger governs if
  the two ever disagree, and every discrepancy is logged and root-caused as
  a pilot defect.
- Prior engagement with the NCUA regional office and state supervisor as
  applicable; the beta proceeds only within whatever supervisory expectations
  they set.
- Deliverables: member-experience findings, reconciliation report (core
  ledger vs. chain), servicing-cost comparison, and a production
  recommendation.

### Success criteria

- Zero unreconciled discrepancies between core ledger and on-chain record.
- Every issuance and redemption independently verifiable by internal audit
  without developer assistance.
- Member-reported clarity of terms at least as good as the paper process.
- No supervisory objection outstanding at the end of Phase 2.

## 8. Team and ask

**Team.** The CDT is led by Noah Jones, who has carried the project from the
original 2021 CampusUSA conversations through the current working prototype
(smart contracts, oracle design, and bank-integration model). The pilot plan
assumes adding two part-time contributors during Phase 1: a Cardano/Aiken
engineer for contract hardening and audit support, and an integration
engineer familiar with credit-union core systems.

**The ask.** From CampusUSA (or a comparable partner institution):

1. A sponsoring executive and a working group (IT, compliance, member
   services) for the duration of Phase 1.
2. Read-only access to a staging copy of the core banking system for the
   testnet pilot.
3. A joint go/no-go review at the end of each phase.
4. Co-engagement with the NCUA regional office ahead of Phase 2.

From partners and grant programs (e.g., Project Catalyst): funding for the
two Phase 1 engineering roles and an independent smart-contract audit before
any member-facing use.

The prototype exists. The regulatory groundwork is being laid by others as we
speak. The remaining question is which credit union demonstrates it first —
and CampusUSA asked to see this demonstration back in 2021.
