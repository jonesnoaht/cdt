# CDT Business Plan

**Company (proposed):** CDT Labs LLC (Florida)
**Author:** Noah Jones
**Status:** Working draft — planning document
**Prepared:** July 2026
**Related documents:** [Proposal](./proposal.md) · [Feasibility study](./feasibility.md) · [Rollout strategy](./rollout.md) · [Compliance analysis](./compliance.md) · [Architecture](./architecture.md) · [Why Cardano](./why-cardano.md)

> **Important disclaimer.** This is an internal planning document. It is
> **not an offer to sell securities**, not a solicitation of investment, and
> not legal, accounting, tax, or investment advice. All financial figures are
> either cited to third-party sources or explicitly labeled as assumptions;
> projections are hypotheses, not forecasts of actual results. Any actual
> financing would be conducted only through proper legal channels with
> counsel, and any product deployment involving member funds would proceed
> only with the issuing institution's board approval and regulator engagement
> as described in the [compliance analysis](./compliance.md).

---

## 1. Executive summary

CDT (Certificate of Deposit Token) turns an ordinary insured share
certificate into a digitally verifiable instrument: the member's deposit
stays at the credit union, and a credential-gated token on Cardano carries
the contract's terms — principal, rate, term, early-withdrawal penalty —
enforced by an on-chain vault. The concept was validated early: CampusUSA
Credit Union (Gainesville, FL) reviewed it in July 2021 and asked for a
working demonstration. That demonstration now exists as a working prototype
— Aiken validators, an oracle attestation service, a bank-core simulator,
mock verifiable credentials, and a full-lifecycle emulator demo — with
testnet deployment and a member web portal in progress.

**The business** is a white-label tokenized-CD issuance platform for the
roughly [4,287 federally insured credit unions](https://ncua.gov/newsroom/press-release/2026/ncua-releases-fourth-quarter-2025-credit-union-system-performance-data)
and the several thousand community banks that sell certificates of deposit —
a product category where large time deposits at US commercial banks alone
stood near
[$2.5 trillion in early 2026](https://fred.stlouisfed.org/series/LTDACBW027SBOG).
These institutions cannot build tokenization capability in-house, and the
vendors now entering the space are focused on stablecoins and payments, not
term deposits. CDT sells the full issuance stack — smart-contract engine,
oracle/attestation service, member portal, and compliance tooling — as a
pilot engagement first, then hosted SaaS, then self-hosted enterprise.

**Why now.** The GENIUS Act (July 2025) made the NCUA a named digital-asset
regulator, and 2026 rulemaking by the FDIC and NCUA explicitly addresses
tokenized deposits ([KPMG regulatory alert](https://kpmg.com/us/en/articles/2026/genius-act-fdic-ncua-occ-proposals-for-applications-prudential-frameworks-reg-alert.html));
the tokenized-deposits market is projected to grow from
[$4.8B in 2025 toward $38.6B by 2034](https://dataintelo.com/report/tokenized-deposits-market).
Credit unions are actively organizing to respond — a Pennsylvania/New Jersey
league launched a
[50-credit-union digital-asset pilot program in 2026](https://www.newswire.com/news/crossstate-metallicus-launch-pilot-program-with-50-credit-unions-to-22781002)
— but no vendor owns the tokenized *certificate* niche.

**The plan.** Form a Florida LLC (the founder's stated need since 2021),
convert CampusUSA's standing demo request into a paid design-partner pilot,
execute the phased rollout already documented in
[rollout.md](./rollout.md), and use the CUSO (credit union service
organization) channel to reach the next ten institutions. The ask: a seed
round of **$1.5M** (assumption; range $1.25M–$2.0M) funding about 24 months of
runway through pilot delivery, a completed member beta, and 3–5 signed
institutions — sized against the $310k–$700k Phase 1–3 delivery cost model
in the [feasibility study](./feasibility.md) plus company-building costs.

**The differentiation.** Regulatory-first design (compliance-by-design
credential gating documented before a line of sales copy), exclusive focus
on the credit-union movement and its cooperative channel structures, and a
chain-isolated architecture that keeps the product portable if the board or
the regulator prefers different rails.

## 2. Company

### 2.1 Mission

Give every member of an insured institution a certificate they can hold,
verify, and redeem without trusting anyone's paperwork — and give every
credit union a safe, supervised on-ramp to digital assets that strengthens,
rather than bypasses, the insured deposit relationship.

### 2.2 Structure and formation (Florida LLC)

The founder's 2021 note — *"I need an LLC and a business card"* — is the
oldest open action item in the project log. Concrete steps and costs:

| Step | Action | Cost | Notes |
| --- | --- | --- | --- |
| 1 | Name search + file Articles of Organization on [Sunbiz](https://dos.fl.gov/sunbiz/forms/fees/llc-fees/) | $125 one-time | $100 filing fee + $25 registered-agent designation |
| 2 | Registered agent | $0–$150/yr | Founder may self-serve at a Florida street address; commercial agents run [$50–$150/yr](https://www.nsktglobal.com/usa/blog/how-to-register-an-llc-in-florida-2026-complete-guide) |
| 3 | EIN from the IRS | Free | [Online application](https://www.irs.gov/businesses/small-businesses-self-employed/get-an-employer-identification-number), same-day |
| 4 | Operating agreement | $0–$1,500 (estimate) | Template acceptable single-member; attorney review before any outside money |
| 5 | Business bank account | $0–$25/mo (estimate) | Requires Articles + EIN; keeps pilot revenue and grant funds segregated from day one |
| 6 | Annual report | [$138.75/yr, due May 1](https://dos.fl.gov/sunbiz/manage-business/efile/annual-report/) | $400 late penalty if missed ([Finberg Firm summary](https://finbergfirm.com/2026/03/28/florida-llc-annual-report-2026-deadlines-requirements-and-penalties-for-small-businesses/)) |

Total cost to be a real company: **under $300 in year one** (assumption:
self-serve registered agent, template operating agreement). Florida is the
natural home: the design partner is in Gainesville, Florida has no personal
income tax, and an LLC's pass-through treatment fits a pre-revenue stage.

Two structural notes for later, flagged now:

- **Venture financing.** Institutional seed investors typically require a
  Delaware C-corp; plan a statutory conversion at the time a priced round or
  institutional SAFE is signed, not before. (Assumption based on standard
  venture practice; confirm with counsel.)
- **CUSO qualification.** Credit unions may invest in or lend to credit
  union service organizations under
  [12 CFR Part 712](https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-712).
  If credit unions themselves become investors — a powerful alignment play
  in this market, and one the NCUA's 2026 rulemaking direction favors (its
  proposed digital-asset rules treat CUSOs as an appropriate vehicle for
  credit-union digital-asset activity — see
  [landscape analysis](https://www.paymentexecutive.com/post/tokenized-deposits-for-community-banks-and-credit-unions-landscape-analysis-and-use-cases))
  — the entity (or a subsidiary) must qualify as a CUSO. Keep the option
  open in the operating agreement; decide at seed.

### 2.3 Founder

Noah Jones — founder. Carried CDT from the original 2021 CampusUSA
conversations and Plutus-era prototypes through the 2026 rebuild: smart
contracts (Aiken), oracle design, bank-integration model, and the
documentation suite in this repository. *(Placeholder: expand with formal
background, education, and prior work history for the investor version.)*

## 3. Problem and solution

Condensed from the [proposal](./proposal.md), in business terms.

### 3.1 The problem

- **CDs are administered like it's 1975.** A paper certificate or a core
  ledger line, redeemable only at the issuer, verifiable by third parties
  only through manual confirmation, and exitable before maturity only by
  breaking the CD and paying the penalty.
- **Credit unions lack a safe digital-asset answer.** Members — especially
  younger ones — are moving savings to uninsured crypto platforms. Custody
  of speculative assets is a poor fit for the movement's risk culture, but
  doing nothing cedes the demographic.
- **Servicing is manual and error-prone.** Rate accrual, maturity notices,
  penalty math, and audit evidence all run through batch processes and human
  reconciliation — every step a cost and an error surface.

### 3.2 The solution

CDT moves the *evidence of the contract* on-chain while the money stays in
the insured institution. An oracle verifies (a) the deposit exists in the
core ledger and (b) the member's credential chain (NCUA → credit union →
member), then co-signs the mint. The token's terms are locked in a vault
validator that enforces payout at maturity and the penalty before it.
Three properties close the sale to a financial institution:

1. **The deposit never leaves the institution** — insurance analysis is
   unchanged in substance.
2. **Issuance is credential-gated** — KYC/BSA is preserved by construction,
   not by policy.
3. **Terms are self-enforcing** — servicing cost and dispute surface shrink
   because the contract is code.

## 4. Product

### 4.1 What exists today

- **Working prototype (Phase 0, complete).** Aiken (Plutus V3) vault and
  mint validators; TypeScript transaction library; oracle watcher that
  polls a Postgres bank-core simulator and verifies mock DID/VC credentials;
  full-lifecycle narrated demo on a local emulator (`npm run demo`). This is
  the demonstration CampusUSA asked for in 2021, reproducible on a laptop.
- **In progress (sibling workstreams, July 2026):** public-testnet
  deployment, packaging/integration of the off-chain libraries, an
  issuance-pipeline service, and a member-facing web portal.

### 4.2 What we sell

A **white-label tokenized-CD issuance platform** for credit unions and
community banks, comprising:

| Component | What it does | Status |
| --- | --- | --- |
| Issuance engine | Validators + transaction pipeline that mints, services, and redeems tokenized certificates | Prototype working; pipeline service in progress |
| Oracle / attestation service | Watches the core ledger, verifies credentials, co-signs mints, runs daily core↔chain reconciliation | Prototype working |
| Member portal | White-labeled UI where members open, view, verify, and redeem certificates; custodial wallet default | In progress |
| Compliance tooling | Attestation trail export, examiner-facing reports, datum-schema audit gate, disclosure templates mapped to the [compliance analysis](./compliance.md) | Documented; tooling to build |
| Core integration adapters | Read-path connectors for Fiserv / Jack Henry Symitar / Corelation cores (batch and API variants) | Phase 1 discovery work |

### 4.3 Product tiers

| Tier | Target buyer | Delivery | Contents |
| --- | --- | --- | --- |
| **Pilot (design partner)** | 1–3 innovation-minded credit unions | Fixed-scope engagement per rollout phase | Testnet pilot, core-integration discovery, board/NCUA briefing materials, go/no-go evidence pack |
| **Hosted SaaS** | Credit unions $100M–$5B assets | Multi-tenant hosted platform, we operate oracle + infra | Issuance engine, portal, compliance reporting, SLAs |
| **Self-hosted enterprise** | Large CUs / corporate CUs / CUSO consortia with vendor-risk mandates | Licensed deployment in the institution's environment | Full stack + federated-oracle option, annual license and support |

The tier ladder mirrors the [rollout phases](./rollout.md): a pilot
engagement *is* Phases 1–2 for that institution, and converts to a SaaS
subscription at Phase 3 (production).

## 5. Market analysis

All figures are third-party estimates gathered in July 2026; re-verify
before any board-level or fundraising use.

### 5.1 TAM — the US time-deposit market and its institutions

- Time deposits are a multi-trillion-dollar category again: large time
  deposits at US commercial banks alone stood at roughly
  [$2.48 trillion in March 2026](https://fred.stlouisfed.org/series/LTDACBW027SBOG)
  (Federal Reserve H.8 data), after the 2022–2025 rate cycle pulled savers
  back into CDs; the [proposal §5](./proposal.md) surveys the broader CD
  market context.
- The institutional universe: [4,287 federally insured credit unions with
  $2.43T in assets and 144.7M members (Q4 2025)](https://ncua.gov/newsroom/press-release/2026/ncua-releases-fourth-quarter-2025-credit-union-system-performance-data)
  plus roughly 4,000 FDIC-insured banks, the large majority community banks
  ([FDIC Quarterly Banking Profile, Q1 2026](https://www.fdic.gov/quarterly-banking-profile/quarterly-banking-profile-q1-2026)).
- The macro wave: tokenized real-world assets reached about
  [$31B on-chain by mid-2026](https://yellow.com/research/tokenized-rwas-31b-market-growth-real-race-starting),
  with institutional forecasts from
  [McKinsey's roughly $2T to Standard Chartered's $30T by the early 2030s](https://investax.io/blog/real-world-asset-tokenization-trends-and-outlook-for-2026);
  tokenized deposits specifically are projected to grow from
  [$4.8B (2025) to $38.6B (2034)](https://dataintelo.com/report/tokenized-deposits-market),
  and [Citi projects broad tokenization of real-world instruments by 2030](https://www.citigroup.com/rcs/citigpa/storage/public/Citi_Institute_GPS_Report_Tokenization_2030.pdf).

If platform software captures even single-digit basis points of tokenized
CD balances in fees (see §6), a $2.1T product category is a very large
ceiling. TAM stated conservatively as *vendor revenue*: about 8,000 US insured
depositories × a mature-platform ACV of about $100k (assumption, §6) ≈ **$800M/yr
addressable software spend**, before any per-issuance economics.

### 5.2 SAM — credit unions first

The serviceable market is the credit-union movement, where CDT's
credential-chain design (NCUA trust root), the CUSO channel, and the
founder's existing relationship live:

- 4,287 FICUs; the realistic buyers are the roughly 700–900 institutions
  above roughly $250M in assets that fund core-adjacent digital projects
  (assumption based on NCUA asset-distribution data; validate in Phase 1).
- SAM ≈ 800 institutions × $100k blended ACV ≈ **$80M/yr** (assumption).

### 5.3 SOM — first three years

What a seed-stage company can credibly win: **1 design partner (CampusUSA)
in year 1, 3–5 institutions by year 2, 7–10 by year 3**, concentrated in
Florida/Southeast league networks — roughly $0.75M year-3 revenue in the
base case, $1.8M in the upside (§10). Even the upside is about 1% of SAM;
the constraint is sales cycle and delivery capacity, not market size.

## 6. Business model

### 6.1 Revenue streams and pricing hypotheses

All prices are hypotheses to be tested with the design partner.

| Stream | Pricing hypothesis | Rationale |
| --- | --- | --- |
| Pilot / design-partner fees | $50k–$150k per rollout phase (Phases 1–2) | Prices the evidence pack (board package, NCUA briefing materials, audit-ready pilot), not just software; partially offsets our delivery cost |
| Hosted SaaS subscription | $3k–$8k/mo by asset tier ($36k–$96k/yr) | Comparable to a mid-tier digital-banking add-on module; below the pain threshold of a core conversion decision |
| Per-CD issuance fee | 5–15 bps of principal at mint, capped per certificate | Aligns our revenue with the CU's deposit growth; at 10 bps, a $25M/yr tokenized issuance book yields $25k |
| Professional services | $25k–$75k per core-integration deployment | Adapter work for Fiserv/Symitar/Corelation read paths; drops as adapters become products |
| Self-hosted enterprise license | $150k+/yr license + support | For institutions whose vendor-risk posture requires in-house operation; includes federated-oracle tooling |

Blended mature ACV hypothesis: **about $100k/yr** per institution (SaaS +
issuance fees + support).

### 6.2 Unit economics sketch (assumptions)

For one hosted-SaaS credit union at steady state:

- **Revenue:** $60k platform + $25k issuance fees + $15k support ≈ $100k/yr.
- **Cost to serve:** infrastructure is negligible by design — chain fees for
  a 5,000-CD/yr book are **about $4k–$15k/yr at recent ADA prices**, and API/node
  infrastructure runs tens-to-hundreds of dollars per month
  ([feasibility §4.2–4.3](./feasibility.md)); add about 0.1 FTE support/SRE
  (about $15k–$20k). Cost to serve ≈ $25k–$35k.
- **Gross margin ≈ 65–75%**, typical of vertical SaaS, with the margin
  driver being oracle-operation automation (built in Phase 1 as monitoring
  and reconciliation tooling).
- **CAC:** long credit-union sales cycles put fully loaded CAC at
  $30k–$60k/logo (assumption); at $100k ACV and 70% margin, payback is
  under 12 months once the reference pilot exists.

### 6.3 What we do not monetize

No interchange, no float, no yield programs, no token trading. The
[compliance analysis](./compliance.md) is blunt that pooling, yield
enhancement, or secondary-market promotion would convert the product into a
securities offering (*Gary Plastic*). The business model is software and
services to insured institutions, full stop.

## 7. Go-to-market

### 7.1 Beachhead: CampusUSA as design partner

CampusUSA asked for this demonstration in 2021; the demo exists. The first
GTM motion is a single meeting with the concrete ask already framed in
[proposal §8](./proposal.md) — an executive sponsor, a working group,
read-only staging access to the core, and joint go/no-go reviews — extended
in this plan with a commercial term: a paid Phase 1 pilot fee. (The proposal
routes Phase 1 funding to grants such as Project Catalyst; the company plan
treats pilot fees and grants as complementary funding hypotheses, and the
conservative scenario in §10.2 assumes the pilot is unpaid.) One successful
design partner produces the three assets every subsequent sale needs — a
reference customer, a real core-integration adapter, and an NCUA-briefed
evidence pack.

### 7.2 Channel: the CUSO ecosystem

Credit unions buy cooperatively. The CUSO channel is how fintech reaches
them at scale, and the NCUA's 2026 digital-asset rulemaking direction
explicitly favors CUSOs as the vehicle for pooled digital-asset capability
([landscape analysis](https://www.paymentexecutive.com/post/tokenized-deposits-for-community-banks-and-credit-unions-landscape-analysis-and-use-cases)).
Channel plays, in order:

1. **State leagues.** The League of Southeastern Credit Unions (Florida's
   league) is the natural first partner given the Gainesville beachhead;
   the [CrossState/Metallicus 50-CU pilot program](https://www.newswire.com/news/crossstate-metallicus-launch-pilot-program-with-50-credit-unions-to-22781002)
   proves leagues will convene digital-asset cohorts.
2. **NACUSO.** Present at the
   [NACUSO Reimagine conference](https://cusomag.com/2026/05/07/highlights-and-takeaways-from-the-2026-nacuso-reimagine-conference/),
   which now runs a dedicated FinTech CUSO of the Year track; target
   CUSO-of-the-year visibility once the pilot has public results.
3. **Credit-union-owned capital.** Curql and similar CU-owned funds invest
   specifically in vendors their member institutions will buy from —
   a seed-extension or Series A candidate that doubles as distribution.
4. **CUSO formation.** If 2–3 credit unions want ownership, spin the hosted
   platform into a jointly owned CUSO under
   [12 CFR Part 712](https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-712)
   (§2.2) — converting customers into owners with aligned incentives.

### 7.3 Positioning: regulatory-first

Every competitor is selling speed; CDT sells *supervisability*. The sales
kit is the documentation suite in this repository: a
[compliance analysis](./compliance.md) mapped to NCUA letters, share
insurance, BSA/CIP, and the securities case law; a
[phased rollout](./rollout.md) with go/no-go gates; and a
[feasibility study](./feasibility.md) with an honest risk register. For a
buyer whose board answers to an NCUA examiner, "here is the exam-ready
evidence pack" beats "here is a token." Conference presence follows the
same posture: America's Credit Unions' Governmental Affairs Conference
(GAC) and league events, presenting with the design partner rather than
alone.

### 7.4 Sales motion and cycle

Assume 9–18 month cycles: league/CUSO introduction → executive demo (the
emulator demo, then testnet) → board education packet → paid Phase 1 pilot
→ SaaS conversion at Phase 3. Pipeline math at steady state (assumption):
20 qualified conversations → 6 pilots → 4 production conversions per year
per salesperson-equivalent.

## 8. Competitive landscape

### 8.1 Tokenized-deposit and credit-union digital-asset players (2026)

| Player | What they do | Relationship to CDT |
| --- | --- | --- |
| [Metallicus / Metal blockchain](https://www.newswire.com/news/crossstate-metallicus-launch-pilot-program-with-50-credit-unions-to-22781002) | CUSO running credit-union blockchain "banking innovation program"; stablecoin and payments focus; league partnerships | Closest channel competitor; validates the market. Payments/stablecoin focus, own permissioned chain — not term-deposit instruments |
| [DaLand CUSO](https://www.dalandcuso.com/post/daland-cuso-empowers-credit-unions-with-institution-branded-stablecoins-via-new-metallicus-partnersh) | Core-connectivity CUSO; institution-branded stablecoins via Metallicus | Potential partner as much as competitor (core-connection expertise) |
| [BankSocial](https://www.cutoday.info/THE-feature/BankSocial-Launches-Tokenized-Shared-Branching-Network-Aiming-To-Modernize-Credit-Union-Payments) | Tokenized shared-branching / settlement network for credit unions (Hedera) | Inter-institution payments settlement, not member-held certificates |
| [Stablecore](https://www.paymentexecutive.com/post/tokenized-deposits-for-community-banks-and-credit-unions-landscape-analysis-and-use-cases) | Stablecoin/tokenized-deposit accounts for community banks and CUs; joined the Jack Henry fintech integration network in early 2026, gaining reach into Jack Henry's core-client base across banks and credit unions; Curql-backed | Most dangerous distribution position; transactional deposit accounts, not fixed-term certificates |
| [Cari Network](https://www.techmagazines.net/tokenized-deposits-are-bankings-biggest-bet-of-2026-and-the-race-has-already-started/) | Five-bank US regional consortium for tokenized deposits | Bank-side consortium; signals category legitimacy |
| JPMorgan (Kinexys), Citi Token Services | Big-bank tokenized-deposit rails for institutional payments | Different buyer entirely; useful for regulator familiarity |

### 8.2 Core-banking incumbents

[Fiserv leads credit-union core processing with about 29% of institutions
(1,432 clients), Jack Henry's Symitar serves 522, and Corelation's KeyStone
serves 145 (about 3%)](https://www.cutoday.info/Fresh-Today/Report-Reveals-State-of-Market-Share-Among-CU-Core-Processors).
Any of them could bundle tokenization eventually — Jack Henry is already
distributing third-party digital-asset capability through its integration
network. The realistic posture is **integrate, don't fight**: CDT's core
adapters make the incumbents' platforms the read-path, and a fintech
integration network listing (Jack Henry's, Fiserv's AppMarket) is a
distribution goal, not a threat vector. The incumbents' incentive to build
a *Cardano-based, credential-gated CD* product themselves is low; their
history is to acquire proven point solutions.

### 8.3 Differentiation

1. **The instrument.** Everyone else tokenizes *transactional* money
   (stablecoins, settlement). CDT tokenizes the *term deposit* — the
   product credit unions actually use to compete for savings, with large
   time deposits alone near
   [$2.5T at US commercial banks](https://fred.stlouisfed.org/series/LTDACBW027SBOG)
   — and the eUTxO datum model is unusually well matched to a fixed-term
   contract ([why-cardano](./why-cardano.md)).
2. **Credential-gated compliance-by-design.** The NCUA → institution →
   member verifiable-credential chain is enforced by the minting policy
   itself; KYC/BSA and the non-transferability control that keeps the token
   out of securities territory are ledger-level invariants, not policy
   documents ([compliance §10](./compliance.md)).
3. **Credit-union-native focus.** Cooperative channel (leagues, NACUSO,
   CUSO structure), NCUA-specific regulatory mapping, and a design partner
   whose interest predates the current hype cycle by four years.
4. **Chain-agnostic isolation.** The on-chain layer is two small validators
   behind one provider interface; porting to a permissioned ledger or
   another chain is re-implementing a thin layer, not the system
   ([why-cardano, fallback section](./why-cardano.md)). Boards that require
   a permissioned deployment are a configuration, not a lost deal.

## 9. Operations and team

### 9.1 Roles needed

Aligned with the staffing table in [feasibility §3.1](./feasibility.md),
translated from project roles into company roles:

| Role | Scope | When |
| --- | --- | --- |
| Founder / CEO (Noah Jones) | Product, design-partner relationship, fundraising, regulatory posture | Now |
| Smart-contract / off-chain engineer | Aiken validators, tx pipeline, audit support | Month 0–3 |
| Integrations engineer | Core-banking read paths (Fiserv/Symitar/Corelation), oracle hardening | Month 4–6 |
| Compliance lead | Owns the evidence pack, BSA/disclosure templates, examiner interface | Fractional month 3; full-time around month 12 |
| Sales / partnerships | League + CUSO channel, pipeline | Month 9–12 |
| DevOps / SRE | Oracle operations, on-call, reconciliation automation | Month 12–18 |

Five to six FTE-equivalents by month 18 (some fractional/contract), matching
the feasibility study's assumption of a small dedicated team plus vendors.

### 9.2 Advisory needs

- **Securities counsel** — standing relationship, not one-off opinions; the
  *Marine Bank / Gary Plastic* line is the product's legal perimeter.
- **Former NCUA examiner** — reviews the evidence pack the way an examiner
  will; opens regional-office conversations correctly.
- **Credit-union core-systems veteran** — Symitar/KeyStone integration
  reality checks; ideally a retired CU CTO.
- **CUSO executive** — channel strategy and, if pursued, CUSO formation.

Advisor compensation: standard 0.25%–1.0% equity over 2-year vests
(assumption; market norms).

### 9.3 18-month hiring plan

| Months | Hires | Cumulative team |
| --- | --- | --- |
| 0–3 | Founding smart-contract engineer; fractional compliance; securities counsel + examiner advisors | 2.5 |
| 4–9 | Integrations engineer; contract designer for portal polish | 3.5 |
| 9–12 | Sales/partnerships lead (league/CUSO network native) | 4.5 |
| 12–18 | SRE/DevOps; compliance lead to full-time | 6 |

## 10. Financial plan

All projections are planning assumptions, not forecasts. Cost anchors come
from the [feasibility study](./feasibility.md): Phases 1–3 delivery at
**$310k–$700k** (26–39 person-months at $12k–$18k blended), plus
**about $100k–$200k** in audits, legal, and infrastructure. Those figures are the
*per-first-deployment delivery cost*; the company plan adds
company-building costs (sales, G&A, product generalization) on top.

### 10.1 Operating cost model (annual, assumptions)

| Category | Year 1 (FY27) | Year 2 (FY28) | Year 3 (FY29) |
| --- | --- | --- | --- |
| People (per §9 ramp, blended $12k–$18k/person-month) | $450k–$600k | $750k–$950k | $1.0M–$1.3M |
| Audits, pentest, legal (feasibility §4.4) | $60k–$120k | $60k–$120k | $50k–$100k |
| Infrastructure + tooling (feasibility §4.2) | $15k–$30k | $25k–$50k | $40k–$80k |
| Sales, travel, conferences (GAC, NACUSO, leagues) | $20k–$40k | $50k–$80k | $80k–$120k |
| G&A (formation, insurance, accounting) | $20k–$40k | $40k–$60k | $50k–$80k |
| **Total burn** | **$565k–$830k** | **$925k–$1.26M** | **$1.22M–$1.68M** |

Year 1 + Year 2 people-plus-audit spend contains the feasibility study's
$310k–$700k + $100k–$200k first-deployment envelope; the delta is the
company wrapper (sales, G&A, productization).

### 10.2 Revenue projections — three scenarios (assumptions)

Scenario drivers: number of paying institutions and blended ACV (§6).
"Institutions" counts pilots and production customers; pilot fees are
recognized in the year delivered.

| Scenario | Year 1 (FY27) | Year 2 (FY28) | Year 3 (FY29) |
| --- | --- | --- | --- |
| **Conservative** — pilot slips; no second logo until Y3 | $0 (unpaid pilot) | $50k (1 pilot fee) | $150k (1 production + 1 pilot) |
| **Base** — CampusUSA paid pilot converts; league channel opens in Y2 | $75k (Phase 1 pilot fee) | $250k (1 production conversion + 2 pilots) | $750k (4 production ≈ $100k ACV + 3 pilots + services) |
| **Upside** — league cohort effect; CUSO co-ownership | $150k (Phases 1–2 fees) | $600k (2 production + 4 pilots + services) | $1.8M (10 production + pipeline of 6) |

### 10.3 Net cash and break-even

Using scenario midpoints against the cost midpoints:

| Scenario | Y1 net | Y2 net | Y3 net | Cumulative 3-yr | Break-even |
| --- | --- | --- | --- | --- | --- |
| Conservative | −$700k | −$1.04M | −$1.30M | −$3.04M | Not within 3 years; requires bridge or shutdown decision at month 18 gate |
| Base | −$625k | −$840k | −$700k | −$2.17M | Cash-flow break-even around Y4 at 12–15 production institutions × $100k ACV |
| Upside | −$550k | −$490k | +$350k | −$690k | Cash-flow positive in Y3 |

The honest read: **the base case needs about $2.2M of total capital to reach
break-even scale** — a seed round now and either early revenue outperformance
or a small Series A / Curql-style strategic round in year 2–3. The
conservative case is designed to fail cheaply: the rollout gates
([feasibility §7](./feasibility.md)) give explicit stop points before the
company overspends into a market that said no.

### 10.4 Funding ask and use of funds

**Seed: $1.5M** (range $1.25M–$2.0M), consistent with — but deliberately
below — the 2026 median fintech seed of about $3.2M
([Pitchwise data](https://www.pitchwise.se/blog/median-seed-round-size-by-industry-in-2026-data)),
because the prototype is built and the first customer conversation is 5
years warm. Target about 24 months of runway at the
base-case burn. Instrument: SAFE or priced round per counsel; convert to
Delaware C-corp at signing (§2.2).

| Use of funds | Allocation | Maps to |
| --- | --- | --- |
| Engineering (contracts, integrations, portal) | 45% (about $675k) | Feasibility Phases 1–2 delivery ($168k–$378k per [feasibility §4.1](./feasibility.md)) plus productization beyond single-institution scope |
| Audits, pentest, legal opinions | 12% (about $180k) | Gate B requirements |
| Compliance + regulatory engagement | 10% (about $150k) | NCUA briefings, evidence pack |
| Sales + channel (league, NACUSO, GAC) | 15% (about $225k) | §7 go-to-market |
| G&A + reserve | 18% (about $270k) | Company operations, contingency |

Supplementary non-dilutive paths: Project Catalyst grants (already
identified in [proposal §8](./proposal.md)) and paid pilot fees.

### 10.5 Cap-table note

Founder holds 100% at formation. Plan for a 10% employee option pool at
seed (assumption; standard practice), advisor grants per §9.2, and—if the
CUSO route is taken—credit-union investment structured so NCUA Part 712
qualification and venture-investor expectations are reconciled by counsel
*before* the round, not after. No token, and no plan for one: the CDT asset
is an instrument record minted per-certificate under each institution's
authority, not a company token — there is nothing to allocate.

## 11. Milestones and KPIs

Milestones are tied to the [rollout phases and gates](./rollout.md) and the
go/no-go criteria in [feasibility §7](./feasibility.md).

### 11.1 6-month targets (through about Jan 2027)

- Florida LLC formed, EIN, bank account (§2.2) — cost <$300.
- CampusUSA demo meeting held; executive sponsor named; Phase 1 pilot
  agreement signed (Gate A) — **the single most important milestone**.
- Seed round closed or Catalyst grant secured to bridge.
- Testnet deployment live (in progress now); founding engineer hired.
- KPIs: 1 signed design partner; ≥10 league/CUSO qualified conversations;
  emulator→testnet demo conversion of the sales kit.

### 11.2 12-month targets (through about Jul 2027)

- Phase 1 complete against the rollout metrics: ≥99% lifecycle completion,
  0 unexplained reconciliation mismatches, ≥99.5% oracle availability,
  core-API read path prototyped against the actual vendor surface.
- Gate B evidence pack assembled: scoped audit, pentest, legal opinion,
  board approval, NCUA briefing.
- 2 additional pilot LOIs; NACUSO Reimagine presence booked.
- KPIs: Gate B GO; pipeline ≥ 10 qualified institutions; burn within §10.1
  Year-1 envelope.

### 11.3 24-month targets (through about Jul 2028)

- Phase 2 member beta complete including ≥1 full CD maturity cycle, ≥50
  members, 0 fund-safety incidents, CSAT ≥4/5 (rollout §4.3).
- Gate C GO; CampusUSA converts to production SaaS.
- 3–5 institutions signed (mix of pilots and conversions); first non-pilot
  revenue; Series A / strategic round decision made from evidence, not
  hope.
- KPIs: total revenue ≥ $250k for the year, mixing recurring and pilot
  fees (base case §10.2); 2 core-vendor adapters productized;
  zero unresolved supervisory objections.

If Gate B or Gate C returns NO-GO, the corresponding company decision is
pre-committed: pause hiring, preserve runway, and either remediate the
specific gate failure or wind down — the same stop-cheaply discipline the
rollout plan imposes on the product.

## 12. Risks

Top five, condensed from the [feasibility risk register](./feasibility.md)
plus company-level risks. Likelihood/impact: L/M/H.

| # | Risk | L | I | Mitigation |
| --- | --- | --- | --- | --- |
| 1 | **Sales-cycle length.** Credit-union procurement runs 9–18+ months; a seed-stage company can die waiting | H | H | Paid pilots monetize the cycle itself; league/CUSO cohorts parallelize prospecting; 24-month runway spans at least one full cycle end-to-end with margin; conservative-case stop gates (§10.3) |
| 2 | **Core-banking integration blocked** (feasibility R1) — vendor refuses API access or offers only batch | M | H | Phase 1 discovery before member commitments; batch-file fallback designed in; integrate-don't-fight posture with core vendors (§8.2), including their fintech integration programs |
| 3 | **Regulatory posture shift** (feasibility R5) — NCUA final rules or supervisory stance turn adverse; securities characterization risk if discipline slips | M | H | Regulatory-first positioning is the moat *because* it tracks the rules; non-transferable design keeps the *Marine Bank* safe harbor; standing securities counsel; product survives as permissioned-ledger deployment if public-chain posture hardens (§8.3) |
| 4 | **Key-person risk.** The founder is currently the engineer, the salesperson, and the CampusUSA relationship | H | H | First hire is a contracts engineer (month 0–3); document everything (this repo is the practice); advisor bench (§9.2); key-person insurance at seed; design-partner relationship institutionalized to the working group, not one contact |
| 5 | **Competitor with distribution** — a Curql-backed or core-vendor-distributed player (e.g., Stablecore via Jack Henry) extends from stablecoin accounts into term certificates | M | M | Move first in the CD niche with a live, examiner-reviewed reference; pursue the same integration networks; differentiation is the compliance evidence pack and instrument design, which are slow for a payments-focused team to replicate |

Secondary risks (oracle key compromise, validator bugs, adoption
shortfall, reconciliation failures, ADA fee exposure) are inventoried with
mitigations in [feasibility §6](./feasibility.md) and are managed at the
product layer by the rollout gates.

## 13. Appendix

### 13.1 Repository document suite

| Document | Contents |
| --- | --- |
| [README](../README.md) | Project overview, quickstart, 2021 history |
| [Proposal](./proposal.md) | Business proposal prepared for credit-union leadership; pilot structure |
| [Architecture](./architecture.md) | Technical design: validators, oracle, credentials, bank integration |
| [Why Cardano](./why-cardano.md) | Chain selection matrix and honest trade-off analysis |
| [Compliance](./compliance.md) | Securities, NCUA, insurance, BSA/AML, GLBA, UCC analysis |
| [Feasibility](./feasibility.md) | Technical/operational/economic/regulatory feasibility; cost model; risk register; phase gates |
| [Rollout](./rollout.md) | Four-phase rollout with metrics, gates, and communication plan |

### 13.2 Key external sources

- [NCUA Q4 2025 credit union system performance data](https://ncua.gov/newsroom/press-release/2026/ncua-releases-fourth-quarter-2025-credit-union-system-performance-data)
- [FDIC Quarterly Banking Profile, Q1 2026](https://www.fdic.gov/quarterly-banking-profile/quarterly-banking-profile-q1-2026)
- [Large time deposits, all US commercial banks (Federal Reserve H.8 via FRED)](https://fred.stlouisfed.org/series/LTDACBW027SBOG)
- [Tokenized deposits market forecast](https://dataintelo.com/report/tokenized-deposits-market)
- [Tokenized RWA market, mid-2026](https://yellow.com/research/tokenized-rwas-31b-market-growth-real-race-starting)
- [KPMG on GENIUS Act prudential rulemaking](https://kpmg.com/us/en/articles/2026/genius-act-fdic-ncua-occ-proposals-for-applications-prudential-frameworks-reg-alert.html)
- [Tokenized deposits for community banks and credit unions — landscape](https://www.paymentexecutive.com/post/tokenized-deposits-for-community-banks-and-credit-unions-landscape-analysis-and-use-cases)
- [CrossState/Metallicus 50-credit-union pilot](https://www.newswire.com/news/crossstate-metallicus-launch-pilot-program-with-50-credit-unions-to-22781002)
- [Credit-union core processor market share](https://www.cutoday.info/Fresh-Today/Report-Reveals-State-of-Market-Share-Among-CU-Core-Processors)
- [Florida LLC fees (Division of Corporations)](https://dos.fl.gov/sunbiz/forms/fees/llc-fees/) · [Annual report filing](https://dos.fl.gov/sunbiz/manage-business/efile/annual-report/)
- [IRS: get an EIN](https://www.irs.gov/businesses/small-businesses-self-employed/get-an-employer-identification-number)
- [Median seed round size by industry, 2026](https://www.pitchwise.se/blog/median-seed-round-size-by-industry-in-2026-data)
- [12 CFR Part 712 (CUSOs)](https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-712)

---

*This business plan is a planning document prepared alongside the CDT
prototype. It is not an offer of securities, a solicitation of investment,
or professional advice of any kind. Market figures are third-party
estimates as of July 2026; all pricing, projections, and scenario tables
are assumptions for planning and must be re-validated before use with
investors, boards, or regulators.*
