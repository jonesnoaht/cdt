# Regulatory & Compliance Analysis — Certificate of Deposit Token (CDT)

> **DISCLAIMER — READ FIRST.**
> This document is an educational analysis prepared for the CDT prototype project. It is
> **not legal advice**, it does not create an attorney–client relationship, and it must not
> be relied upon as a substitute for advice from qualified securities, banking, and
> fintech counsel. CDT is a research prototype; **no pilot involving real member funds may
> proceed without a formal legal review**, engagement with the credit union's prudential
> regulator (NCUA and, for state charters, the state supervisory authority), and — where
> the securities analysis below identifies open questions — engagement with SEC staff
> (e.g., a no-action request or exemptive relief). Statements about regulation reflect the
> authors' understanding as of mid-2026 and may be outdated when you read this.

## 1. What CDT is, in regulatory terms

CDT tokenizes a **share certificate** (the credit-union analog of a bank certificate of
deposit) issued by a federally insured credit union (FICU):

- The member's dollars **remain on deposit** at the credit union, in a dedicated CD
  funding account in the core banking system. No funds move on-chain.
- An **oracle** operated by (or for) the credit union attests that the deposit exists and
  matches the contracted terms, and only then is a **CDT token minted** on Cardano. The
  token's datum records the CD contract — principal, rate, start date, maturity, and
  early-withdrawal penalty — plus payment key hashes. **No personal information is
  written on-chain** (see §6).
- **Credential gating:** the NCUA (in the demo, a simulated NCUA root of trust) issues an
  `InsuredInstitutionCredential` to the credit union; the credit union issues an
  `AccountHolderCredential` to the member after KYC; the oracle verifies both before
  attesting.
- **Redemption** burns the token, and a vault (pre-funded by the credit union with
  principal plus interest in the demo) pays out; in production the payout leg would be a
  core-banking disbursement to the member's share account.

Two characterizations drive almost everything below:

1. The **underlying instrument** is an ordinary federally insured share certificate — a
   deposit product governed by the Federal Credit Union Act and NCUA rules, not (without
   more) a security.
2. The **token** is a ledger representation of that deposit claim — functionally a
   *tokenized deposit*, not a payment stablecoin and not an investment product — **so long
   as** its transferability and marketing are constrained as described in §2 and §4.

The rest of this document tests those characterizations against each body of law.

## 2. Securities-law analysis (SEC)

### 2.1 Is a conventional insured CD a security? Generally no — *Marine Bank v. Weaver*

In [*Marine Bank v. Weaver*, 455 U.S. 551 (1982)](https://supreme.justia.com/cases/federal/us/455/551/),
the Supreme Court held that a conventional certificate of deposit issued by a federally
insured bank is **not** a "security" under the Securities Exchange Act. The Court's
reasoning is squarely on point for CDT: the holder of an insured CD is "abundantly
protected under the federal banking laws," including deposit insurance and comprehensive
prudential regulation, so the added protections of the securities laws are unnecessary.
The same logic extends to federally insured credit union share certificates, which are
insured by the NCUSIF and regulated by the NCUA on terms comparable to FDIC-insured bank
deposits (and "deposits insured by the National Credit Union Share Insurance Fund" enjoy
statutory parity in most contexts).

Two caveats built into *Marine Bank* matter here:

- **Footnote 11 / case-by-case analysis.** The Court cautioned that each transaction must
  be analyzed on its own facts; the *Weaver* CD escaped securities treatment because it
  was an ordinary insured deposit, not because "CD" is a magic label.
- **Common trading vs. private arrangement.** *Marine Bank* also held that a unique,
  privately negotiated profit-sharing agreement built around the CD was **not** a
  security, because it was not an instrument of "common trading" offered to a broad
  segment of the public. The negative implication is what matters for CDT: broad, public
  distribution is precisely what pulls an arrangement into the securities laws — and it
  is exactly what unrestricted token transferability would create (see §2.2).

### 2.2 The *Gary Plastic* problem: secondary markets can turn CDs into securities

[*Gary Plastic Packaging Corp. v. Merrill Lynch*, 756 F.2d 230 (2d Cir. 1985)](https://openjurist.org/756/f2d/230)
is the key limiting case. Merrill Lynch bought insured CDs from banks and marketed a
program in which it screened issuers, negotiated rates, and — critically — **maintained a
secondary market** so buyers could exit before maturity without early-withdrawal
penalties. The Second Circuit held that CDs sold *through that program* were securities
(both investment contracts under *Howey* and, by the program's economics, instruments in
which the buyer relied on the promoter's efforts and market-making).

The lesson for tokenization is direct: **an insured CD stops being "just a deposit" when
someone builds a liquidity and distribution scheme on top of it.** A freely transferable
CDT trading on Cardano DEXes is, functionally, the *Gary Plastic* secondary market with
better settlement — which is exactly the fact pattern that flips the *Marine Bank*
presumption.

### 2.3 *Reves* family-resemblance test

[*Reves v. Ernst & Young*, 494 U.S. 56 (1990)](https://supreme.justia.com/cases/federal/us/494/56/)
governs when a "note" (and by analogy, other debt-like instruments) is a security. Notes
are presumed securities unless they bear a family resemblance to a judicially recognized
non-security category. Insured CDs are not on *Reves*'s enumerated list of non-security
notes, but the Court expressly reaffirmed *Marine Bank* in articulating its fourth
factor: the existence of another regulatory scheme (there, federal deposit insurance)
that significantly reduces the risk of the instrument can render application of the
securities laws unnecessary. Running the four *Reves* factors on the CDT design:

| *Reves* factor | Non-transferable / allowlisted CDT | Freely transferable CDT |
| --- | --- | --- |
| **Motivations of seller and buyer** | Consumer savings product; member seeks insured fixed return, credit union seeks funding — the classic "commercial/consumer" motivation of a non-security | Same underlying motivation, but a trading market invites purchase for resale/speculation |
| **Plan of distribution** | Issued only to KYC'd members of one credit union; no common trading | Broad distribution to anyone with a wallet ⇒ "common trading for speculation or investment" |
| **Reasonable expectations of the public** | Marketed as an insured deposit | Token markets tend to be perceived as investments; marketing discipline is harder to maintain |
| **Risk-reducing factor (alternative regulatory scheme)** | NCUSIF insurance + NCUA regulation strongly reduce risk — the factor *Marine Bank* found dispositive | Insurance covers the *member's share account*, not a downstream token buyer who may not even be the account holder of record (§4) — the risk-reducing rationale weakens badly |

Conclusion: a CDT that is **non-transferable (or transferable only within a
credit-union-controlled allowlist of KYC'd members, with the share account retitled on
the core ledger at each transfer)** sits comfortably on the non-security side of *Reves*.
A freely transferable CDT does not.

### 2.4 *Howey*

Under [*SEC v. W.J. Howey Co.*, 328 U.S. 293 (1946)](https://supreme.justia.com/cases/federal/us/328/293/),
an investment contract requires (1) an investment of money (2) in a common enterprise
(3) with a reasonable expectation of profits (4) derived from the entrepreneurial or
managerial efforts of others. A fixed-rate, fixed-term insured CD fails prongs (3)–(4):
the return is a **contractual interest rate**, not profit from anyone's entrepreneurial
efforts, and there is no common enterprise pooling. Tokenizing the record of the claim
does not change this. What *would* change it is bundling — e.g., a promoter pooling CDTs,
promising yield enhancement, staking the tokens, or marketing appreciation. The CDT
design must not do any of that, and the credit union should contractually prohibit
third parties from doing it in its name.

### 2.5 What the token adds — SEC's 2024–2026 position on tokenization

The SEC's recent output is unusually clear and cuts both ways for CDT:

- **Commissioner Hester Peirce, "Enchanting, but Not Magical" (July 9, 2025):**
  "[T]okenized securities are still securities... blockchain technology does not have
  magical abilities to transform the nature of the underlying asset."
  ([SEC statement](https://www.sec.gov/newsroom/speeches-statements/peirce-statement-tokenized-securities-070925)).
  Applied symmetrically, this is *good* for CDT: if tokenization does not transform the
  underlying asset, then tokenizing a **non-security** (an insured deposit) does not, by
  itself, create a security. The Peirce statement also warns about **third-party
  "wrapper" tokens** (a token issued by someone other than the issuer of the underlying,
  which may itself be a "receipt for a security" or a security-based swap). CDT avoids
  this failure mode by construction: the token is minted under the authority of the
  **deposit issuer itself**, with a 1:1 correspondence to a specific share certificate on
  the institution's books.
- **SEC staff joint statement on tokenized securities (late January 2026):** staff of the
  Divisions of Corporation Finance, Investment Management, and Trading & Markets issued a
  taxonomy of tokenization models, distinguishing (a) tokens that *are* the issuer's
  official ownership record from (b) third-party receipt/wrapper structures, and
  reiterated that legal treatment follows economic substance, not format (see analyses by
  [Cooley](https://www.cooley.com/news/insight/2026/2026-02-04-statement-on-tokenized-securities)
  and [Dechert](https://www.dechert.com/knowledge/onpoint/2026/2/sec-staff-maps-tokenization-models--tokenized-securities-are-sti.html)).
  For CDT the design answer is model (a) with a twist: the **core banking system remains
  the authoritative record** of the share certificate, and the token is a
  credential-gated representation that the institution treats as controlling only when it
  matches its books (see §4 and §10).
- **"Project Crypto" (Chair Atkins, July 31, 2025 and November 2025):** the SEC's
  modernization agenda includes clarity for on-chain custody and trading of tokenized
  assets and potential exemptive relief to encourage onshore tokenization
  ([Atkins, "American Leadership in the Digital Finance Revolution"](https://www.sec.gov/newsroom/speeches-statements/atkins-digital-finance-revolution-073125);
  [Atkins, "Inside Project Crypto"](https://www.sec.gov/newsroom/speeches-statements/atkins-111225-secs-approach-digital-assets-inside-project-crypto)).
  This is the channel through which a *transferable* CDT could eventually seek relief or
  clarity, but nothing in the 2026 agenda changes the *Gary Plastic* risk today.

### 2.6 Securities-law conclusion and recommended posture

1. **Phase 1 (prototype/pilot): make the token non-transferable** — bound to the member's
   verified payment credential, redeemable only by the holder of the matching
   `AccountHolderCredential`, and burnable only back to the institution. Under
   *Marine Bank*/*Reves*, this is an insured deposit with a novel receipt format, and the
   securities laws very likely do not apply. Cardano-native mechanisms (a validator that
   rejects any transfer not signed by the institution, or CIP-68-style datum checks) make
   this enforceable at the ledger layer, not merely by policy.
2. **Phase 2 (if transferability is ever wanted): allowlisted transfers only**, restricted
   to KYC'd members of the same institution, with each transfer mirrored as a retitling
   of the share certificate on the core ledger (so the on-chain holder is always the
   insured account holder of record). Even this materially increases *Reves*/*Gary
   Plastic* risk and should not launch without counsel and, ideally, **SEC no-action
   assurance or reliance on forthcoming Project Crypto relief**.
3. **Never:** free secondary-market transferability, DEX listings, yield programs,
   pooling, or any marketing of the token as an investment. Any of these likely converts
   the program into an offering of unregistered securities.

## 3. NCUA framework

The issuer is a federally insured credit union, so the NCUA (plus the state regulator,
for a state charter) is the primary supervisor of the whole program.

### 3.1 Permissibility and existing guidance

- **Letter to Credit Unions 21-CU-16, "Relationships with Third Parties that Provide
  Services Related to Digital Assets" (Dec. 2021)** confirms FICUs may partner with
  third-party digital-asset providers subject to due diligence, and stresses that
  uninsured digital assets must be clearly distinguished from insured products
  ([NCUA](https://ncua.gov/regulation-supervision/letters-credit-unions-other-guidance/relationships-third-parties-provide-services-related-digital-assets)).
- **Letter to Credit Unions 22-CU-07, "Federally Insured Credit Union Use of Distributed
  Ledger Technologies" (May 2022)** is the operative green light for CDT's architecture:
  the NCUA "does not prohibit" FICUs from developing, procuring, or using DLT where it is
  deployed **for permissible activities** and in compliance with applicable law
  ([NCUA](https://ncua.gov/regulation-supervision/letters-credit-unions-other-guidance/federally-insured-credit-union-use-distributed-ledger-technologies)).
  Issuing share certificates *is* a core permissible activity (Federal Credit Union Act,
  [12 U.S.C. § 1757(6)](https://www.law.cornell.edu/uscode/text/12/1757)); CDT uses DLT as
  recordkeeping/servicing technology for that activity rather than creating a new asset
  class.
- The NCUA maintains a consolidated
  [Financial Technology and Digital Assets resource page](https://ncua.gov/regulation-supervision/regulatory-compliance-resources/financial-technology-and-digital-assets)
  with current expectations.

### 3.2 What 22-CU-07 expects (mapped to CDT)

22-CU-07's governance expectations, mapped to this project:

| NCUA expectation | CDT answer |
| --- | --- |
| Board is informed of the DLT use case, its purpose, and its alignment with strategy and risk appetite | Board package must cover CDT's purpose (CD servicing), the pilot scope, and exit plan — a real pilot needs a board resolution before launch |
| Risk assessment across information security, third-party, legal/compliance, liquidity, and reputational risk | Formal written risk assessment; the compliance-by-design table in §10 is an input, not a substitute |
| Due diligence on vendors and the underlying technology | Cardano node/oracle/wallet vendors assessed under 21-CU-16 and FFIEC outsourcing guidance (§8) |
| Expertise: does the credit union have (or retain) people who understand the technology? | Named accountable executive; retained DLT expertise; documented key-management procedures |
| Ability to exit/unwind | Because the core ledger remains authoritative, the credit union can always honor certificates off-chain and burn/freeze tokens — this "de-tokenization" path should be documented and tested |

### 3.3 Relevant 12 CFR parts

- **[12 CFR Part 745](https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-745)** —
  share insurance coverage rules (see §4).
- **12 CFR Part 701** — FCU operations; share, share draft, and share certificate
  accounts (§ 701.35) give FCUs flexibility on account terms subject to the FCU Act and
  Truth in Savings ([12 CFR Part 707](https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-707)),
  which requires accurate disclosure of the CD's rate (APY), term, and early-withdrawal
  penalty — the same numbers carried in the token datum must match the Part 707
  disclosures exactly.
- **[12 CFR Part 740](https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-740)** —
  accuracy of advertising and notice of insured status (see §4).
- **[12 CFR Part 748](https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-748)** —
  security program, BSA compliance (§ 748.2), member-information safeguards
  (Appendix A), incident-response guidance (Appendix B), and the **72-hour cyber-incident
  reporting rule** (§ 748.1(c)) — an oracle-key compromise or minting-policy exploit
  would very likely be a reportable cyber incident.
- **12 CFR Part 741** — requirements for insurance, applying many rules to federally
  insured state charters as well.

## 4. Deposit-insurance treatment (NCUSIF; FDIC parallel)

**What is insured:** the member's **share certificate at the credit union**, up to the
$250,000 standard maximum share insurance amount (SMSIA) per member, per institution, per
ownership category, under the FCU Act
([12 U.S.C. § 1787(k)](https://www.law.cornell.edu/uscode/text/12/1787)) and
[12 CFR Part 745](https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-745).
Because the member's dollars never leave the institution, tokenization does not disturb
this: in a liquidation, the NCUSIF pays the member of record on the **institution's
books**, exactly as if no token existed.

**What is not insured: the token.** NCUSIF insurance attaches to the share account, not
to any digital representation of it. Concretely:

- Loss or theft of the member's **wallet keys** is not an insured event. (Design
  mitigation: because the core ledger is authoritative and the token is
  credential-bound, the credit union can re-verify the member's `AccountHolderCredential`,
  invalidate the stranded token, and reissue — a recovery path that must be documented in
  the member agreement.)
- A smart-contract failure, oracle failure, or Cardano network failure is not an insured
  event; the member's claim against the credit union for the deposit survives, but any
  token-layer loss is an operational matter between member and institution.
- If a token ever ended up held by someone who is **not** the member of record (which the
  non-transferable design prevents), that holder would have **no insured claim** — the
  central reason §2 recommends that any future transfer mechanism retitle the share
  account in lockstep.

**Misrepresentation risk.** Both regimes prohibit deceptive claims about insurance:

- NCUA: [12 CFR Part 740](https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-740)
  bars any advertising or representation that "is inaccurate or deceptive in any
  particular" and regulates use of the official insurance sign/statement; 21-CU-16
  specifically tells credit unions to make uninsured digital-asset products clearly
  distinguishable from insured ones.
- FDIC (persuasive parallel): [12 CFR Part 328, subpart B](https://www.ecfr.gov/current/title-12/chapter-III/subchapter-B/part-328)
  prohibits false or misleading representations about deposit insurance, and the FDIC has
  applied it aggressively to crypto firms implying their products are FDIC-insured.

**Marketing rule for CDT:** every member-facing surface must say, in substance —
*"Your certificate of deposit is federally insured by the NCUA up to $250,000. The CDT
token is a record of your certificate. The token itself is not insured, and losing the
token does not affect your insured deposit."* Never describe the token as "an insured
token" or "NCUA-insured crypto."

## 5. BSA/AML and KYC

Federally insured credit unions are "banks" for Bank Secrecy Act purposes and must run a
full BSA/AML program ([12 CFR § 748.2](https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-748);
31 CFR chapter X).

- **Customer Identification Program (CIP),
  [31 CFR § 1020.220](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1020/subpart-B/section-1020.220):**
  collection of identifying information (name, DOB, address, TIN) before account opening,
  with risk-based verification of identity within a reasonable time after opening. In
  CDT, the **`AccountHolderCredential` is issued only after CIP verification is
  complete** (a stricter sequencing than the rule requires) — the credential is
  a *downstream attestation* of CIP, not a replacement for it. The credit union's CIP
  file (documents, verification method, resolution of discrepancies) lives in the core
  system; the credential carries only a signed assertion that CIP passed, plus the
  member's key hash. The oracle's refusal to attest a mint without a valid credential is
  the on-chain enforcement point.
- **Customer Due Diligence / beneficial ownership,
  [31 CFR § 1010.230](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1010/subpart-B/section-1010.230):**
  if business members are ever eligible for CDTs, beneficial-owner identification applies
  at account opening; the credential should then attest CDD at the entity level.
- **OFAC:** screening against SDN and other sanctions lists at (a) membership/CIP, (b)
  credential issuance, (c) each mint attestation, and — if transfers are ever allowed —
  (d) each allowlist change. OFAC's
  [Sanctions Compliance Guidance for the Virtual Currency Industry (Oct. 2021)](https://ofac.treasury.gov/)
  expects address screening and geolocation controls for anything touching public
  chains; wallet addresses bound to credentials should be screened against OFAC's listed
  digital-currency addresses.
- **Monitoring and SARs:** structuring risk is low for a non-transferable CD token, but
  the program must still monitor for unusual funding patterns into CD funding accounts
  (e.g., rapid open/early-withdraw cycles) and file SARs per
  [31 CFR § 1020.320](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1020/subpart-C/section-1020.320)
  and NCUA's suspicious-activity reporting requirements in 12 CFR part 748.
- **Travel Rule:** the recordkeeping and travel rules
  ([31 CFR § 1010.410(e)–(f)](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1010/subpart-D/section-1010.410))
  apply to transmittals of funds of $3,000 or more. In the non-transferable design there
  is **no transmittal of funds between third parties** — deposit and redemption are
  two-party transactions between member and institution — so the Travel Rule adds nothing
  beyond ordinary funds-transfer records. If allowlisted transfers were added, a
  member-to-member CDT transfer with retitling looks like an internal book transfer, but
  counsel should confirm; note also FinCEN and the Federal Reserve
  [proposed in 2020](https://www.federalregister.gov/documents/2020/10/27/2020-23756/threshold-for-the-requirement-to-collect-retain-and-transmit-information-on-funds-transfers-and)
  to lower the cross-border threshold to $250 and to make explicit that "money" includes
  CVC — the proposal was never finalized as of this writing, but it signals direction.
- FinCEN's [2019 CVC guidance (FIN-2019-G001)](https://www.fincen.gov/resources/statutes-regulations/guidance/application-fincens-regulations-certain-business-models)
  frames how FinCEN maps existing MSB rules onto token business models; the credit union
  itself is excluded from MSB status (§9.1) but any *third-party* servicer handling
  tokens for members should be checked against this guidance.

## 6. GLBA — privacy and safeguards

GLBA ([15 U.S.C. § 6801 et seq.](https://www.law.cornell.edu/uscode/text/15/6801))
applies in full: credit unions are financial institutions, and members are consumers.

- **What is on-chain: no nonpublic personal information (NPI).** As specified in the CDT
  architecture, the token datum carries **only payment key hashes and the CD's economic
  terms** (principal, rate, start, maturity, penalty). No name, address, SSN, member
  number, or account number appears on-chain. This is a hard design invariant that a real
  pilot must verify with a datum-schema audit before every release, because a public
  blockchain is **permanent** — an NPI leak on-chain is unremediable. Two residual points
  for counsel: (a) a key hash is pseudonymous, and pairing it with off-chain data could
  make on-chain history *linkable* to a member — the privacy risk assessment should treat
  the datum as potentially re-identifiable; (b) publishing the CD's dollar amount and
  terms, even pseudonymously, is a confidentiality judgment call — batching, rounding, or
  commitment schemes (hash of terms, with plaintext held off-chain) are available
  mitigations if the credit union wants them.
- **Privacy notices (Regulation P,
  [12 CFR Part 1016](https://www.ecfr.gov/current/title-12/chapter-X/part-1016)):** the
  member privacy notice must disclose the categories of information shared with service
  providers (oracle operator, node infrastructure). Sharing NPI with the oracle operator
  as a service provider fits the § 1016.13 service-provider exception with a contract
  limiting reuse.
- **Safeguards:** for credit unions the GLBA safeguards obligation is implemented by
  NCUA's [12 CFR Part 748, Appendix A](https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-748)
  (member-information security guidelines) and Appendix B (incident response). Scope for
  CDT: the **bank database** (core system, CD funding accounts, CIP files), the
  **credential payloads** (the `AccountHolderCredential` contains identity attestations —
  it is NPI and must be encrypted in transit/at rest, and presented selectively), and the
  **oracle signing keys** (their compromise enables fraudulent attestations — HSM
  custody, dual control, and rotation belong in the written information-security
  program).

## 7. SOX — brief

The Sarbanes-Oxley Act's internal-controls mandates (e.g.
[15 U.S.C. § 7262](https://www.law.cornell.edu/uscode/text/15/7262), § 404) apply to
**SEC-reporting public companies**. A credit union is a member-owned cooperative with no
registered securities, so SOX does not apply directly. The functional analogs that *do*
apply — and that an examiner will treat as the internal-controls bar for CDT:

- **Supervisory committee annual audit**
  ([12 CFR Part 715](https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-715)),
  including, for larger credit unions, financial statement audits under GAAS with
  internal-control evaluation.
- **NCUA examinations** (and state exams for state charters), which will scope in the
  CDT program under 22-CU-07's governance expectations.
- Practical implication: the mint/burn log, oracle attestation trail, and reconciliation
  reports between the core ledger and on-chain state should be designed as **auditable
  control evidence** from day one (see §10) — the immutability of the attestation trail
  is genuinely helpful here.

## 8. FFIEC — IT examination framework; PCI-DSS note

The [FFIEC IT Examination Handbook](https://ithandbook.ffiec.gov/) (NCUA is an FFIEC
member) is the examiner's lens on CDT's technology. Mapping the relevant booklets:

| FFIEC booklet / guidance | CDT application |
| --- | --- |
| **Architecture, Infrastructure, and Operations** | Cardano node infrastructure, oracle service, and core-banking integration are in exam scope; document data flows (member → core → oracle → chain) and change management for on-chain code (minting policy, validator) |
| **Information Security** | Key management (oracle keys, minting policy keys, institution wallet), datum-schema controls, monitoring of on-chain events against expected state |
| **Outsourcing Technology Services / third-party risk** | Node hosting, wallet vendors, credential infrastructure = third-party relationships under 21-CU-16 + FFIEC outsourcing expectations: due diligence, contracts, SLAs, exit strategy |
| **Business Continuity Management** | Chain outage or oracle outage must not strand members: the core ledger remains authoritative, and off-chain servicing (honor the CD without the token) is the documented fallback; test it |
| **Development and Acquisition** | Plutus validator and minting-policy code need SDLC controls: peer review, testing (property-based tests for the state machine), and formal sign-off before mainnet deployment |
| **[Authentication and Access to Financial Institution Services and Systems (Aug. 2021)](https://www.ffiec.gov/guidance/Authentication-and-Access-to-Financial-Institution-Services-and-Systems.pdf)** | Layered, risk-based authentication for member actions; a wallet signature alone is single-factor possession — issuance and redemption should require the credential *plus* an authenticated member-channel confirmation for high-value CDs |

**PCI-DSS:** the [Payment Card Industry Data Security Standard](https://www.pcisecuritystandards.org/)
applies to entities that store, process, or transmit **cardholder data**. CDT involves no
card transactions — funding is by share transfer/ACH into the CD funding account — so
PCI-DSS is **out of scope** for the CDT system itself. (If the credit union ever accepted
card-funded deposits, that flow, not CDT, would carry the PCI obligation.) The 2021
repo's listing of PCI-DSS reflected a generic checklist, not this architecture.

## 9. State law and miscellaneous

### 9.1 Money transmission — likely inapplicable, reasoned through

Money-transmitter statutes regulate accepting value from one person for transmission to
another. Three independent reasons CDT should fall outside them:

1. **The funds never move.** The member's dollars sit in the member's own CD funding
   account at the credit union; minting a token transmits nothing. Redemption pays the
   member's own deposit back to the member — a two-party deposit relationship, not
   transmission to a third party.
2. **Depository-institution exemption.** Federal law excludes banks — a term that for BSA
   purposes includes insured credit unions — from the "money services business"
   definition (31 CFR § 1010.100(ff)(8)), and state money-transmission statutes
   (including the CSBS [Money Transmission Modernization Act](https://www.csbs.org/csbs-money-transmission-modernization-act-mtma)
   template most states now follow) exempt federally insured depository institutions.
3. **The token is not a circulating payment instrument.** A non-transferable CDT cannot
   be used to pay anyone; it is a receipt. (This reason weakens if transferability is
   added — another argument for the §2 posture.)

Caveat: if a **third-party servicer** (not the credit union) ever custodied members'
tokens or moved value between members, *that entity's* status under FinCEN's
[2019 CVC guidance](https://www.fincen.gov/resources/statutes-regulations/guidance/application-fincens-regulations-certain-business-models)
and state law would need its own analysis.

### 9.2 UCC Articles 8 and 12 — what the token is as property

The [2022 UCC amendments](https://www.uniformlaws.org/committees/community-home?CommunityKey=1457c422-ddb7-40b0-8c76-39a1991651ac)
added **Article 12 "Controllable Electronic Records" (CERs)** — a technology-neutral
property framework for digital assets based on *control*, with take-free rules for good
faith purchasers ("qualifying purchasers") and revised Article 9 perfection-by-control.
Adoption is broad: 30+ states as of early 2026, with
[New York enacting in December 2025 (effective June 3, 2026)](https://www.orrick.com/en/Insights/2025/12/New-York-Enacts-2022-UCC-Amendments-A-New-Era-for-Digital-Asset-Transactions).

Applied to CDT:

- The CDT token is naturally a **CER** in an Article 12 state: it is an electronic record
  susceptible of control by the key holder. If the token were also structured as a
  **controllable account** or **controllable payment intangible** (an account/payment
  obligation "evidenced by" a CER), the deposit-claim linkage would get Article 12
  treatment too — but note that ordinary **deposit accounts remain governed by Article 9
  deposit-account rules**, and the amendments do not convert the underlying share
  certificate into a CER. Counsel should paper precisely whether the token *evidences*
  the deposit obligation or is a mere record pointer; the member agreement should say
  which, and should state that in any conflict the core ledger controls.
- Article 12's take-free rule is a reason for caution, not comfort: a qualifying
  purchaser of a freely transferable token could take rights **free of competing claims**
  even where the credit union's books disagree — a conflict the non-transferable design
  eliminates.
- **Article 8** (investment securities) would matter only if the certificate were opted
  into Article 8 as an uncertificated security or held through a securities
  intermediary. CDT deliberately does *not* do this — opting into Article 8 would also
  undercut the §2 argument that this is a deposit, not a security.

### 9.3 E-SIGN / UETA — the CD agreement itself

The CD contract (terms, disclosures, member agreement) will be executed electronically.
The federal [E-SIGN Act, 15 U.S.C. § 7001](https://www.law.cornell.edu/uscode/text/15/7001)
and state UETA enactments give electronic records and signatures legal effect. Two
requirements matter:

- **Consumer consent (15 U.S.C. § 7001(c)):** before delivering the Truth in Savings /
  Part 707 disclosures electronically, the credit union must obtain the member's
  affirmative consent electronically, after the required pre-consent disclosures, in a
  manner demonstrating the member can access the format used.
- **Record retention:** the authoritative executed agreement should be retained in the
  core system; a hash of the agreement may be committed on-chain (it is not NPI) to bind
  token and contract cryptographically — a nice-to-have, not a requirement.

Both E-SIGN and UETA are technology-neutral; a signature effected with the member's
wallet key can qualify as an electronic signature if intent and attribution are
documented.

### 9.4 Adjacent regimes to distinguish

- **GENIUS Act (payment stablecoins, enacted July 2025,
  [S.1582](https://www.congress.gov/bill/119th-congress/senate-bill/1582)):** CDT is
  **not** a payment stablecoin — it is not designed for payments, is not redeemable at a
  fixed price on demand (it is a term deposit with an early-withdrawal penalty), and is
  interest-bearing. The Act expressly preserves banks' and credit unions' authority to
  issue **tokenized deposits**, which may pay interest — the category CDT occupies (see
  the [Richmond Fed overview](https://www.richmondfed.org/banking/banker_resources/news_flash/2025/20251118_genius_act)).
  Marketing must nonetheless avoid stablecoin framing so the program is not dragged into
  GENIUS Act scope by its own advertising.
- **CFPB/UDAAP:** as a consumer product, CDT marketing and servicing are subject to
  UDAAP standards (and NCUA's parallel authority); the §4 marketing discipline addresses
  the main exposure.

## 10. Compliance-by-design mapping and gap list

### 10.1 Controls already in the architecture

| Regulation / risk | Architectural control in CDT | Notes |
| --- | --- | --- |
| BSA/AML — CIP/CDD (31 CFR § 1020.220, § 1010.230) | **Credential gating:** `AccountHolderCredential` issued only after CIP; oracle refuses to attest mints without a valid credential | Credential is evidence of KYC, not a substitute for the CIP file |
| OFAC sanctions | Credential issuance and every mint attestation are screening checkpoints; wallet address bound to credential | Add screening of bound addresses against OFAC's listed digital-currency addresses |
| Securities law (*Marine Bank*, *Reves*, *Gary Plastic*) | **Non-transferable token option** enforced by the validator/minting policy — no secondary market can form | The single most consequential control in the design |
| NCUSIF insurance integrity (12 CFR Part 745) | **Funds never leave the institution**; core ledger remains the authoritative record of the insured share certificate | Token loss ≠ deposit loss; recovery/reissue path documented |
| Misrepresentation (12 CFR Part 740; FDIC Part 328 analog) | Token is architecturally a *receipt*, making the "deposit insured / token not insured" disclosure true by construction | Disclosure language still required on every surface |
| GLBA privacy (Reg P; 12 CFR Part 748 App. A) | **No PII/NPI on-chain:** datum carries key hashes and CD terms only; NPI lives in the core system and encrypted credential payloads | Enforce with a datum-schema audit gate in CI; assess linkability of key hashes |
| Auditability / internal controls (Part 715; SOX-analog) | **Oracle attestation trail** and immutable mint/burn log = tamper-evident audit evidence; NCUA-audit collector app in the original design | Add scheduled core-ledger ↔ chain reconciliation reports |
| NCUA 22-CU-07 governance | Oracle verifies the `InsuredInstitutionCredential` — only a verified insured institution can cause issuance | Board reporting and risk assessment are process controls to add |
| FFIEC resilience | Core ledger is authoritative ⇒ documented off-chain fallback servicing when chain/oracle is down | Fallback must be tested, not just documented |
| Truth in Savings (12 CFR Part 707) | CD terms (principal, rate, start, maturity, penalty) carried in the datum are the same terms disclosed at opening | Add an automated consistency check: datum == disclosed terms |
| E-SIGN/UETA | Electronic CD agreement; optional on-chain hash commitment binds token to contract | Implement § 7001(c) consumer-consent flow |
| Money transmission | Two-party deposit/redemption flows only; no value moves between persons on-chain | Holds only while the token is non-transferable |
| PCI-DSS | No card data anywhere in the system | Out of scope; keep it that way |

### 10.2 Gap list — what a real pilot still needs

1. **Legal opinions** from securities and banking counsel on the non-transferable token
   (and a written decision *not* to enable transfers without further review), plus a
   strategy for SEC engagement if transferability is ever pursued.
2. **Regulator engagement before launch:** brief the NCUA regional office (and state
   regulator if applicable); consider NCUA's fintech engagement channels.
3. **Board approval package:** risk assessment, strategic rationale, risk-appetite
   alignment, and exit/unwind plan per 22-CU-07.
4. **Written policies:** key management (HSM, dual control, rotation) for oracle and
   minting keys; token-recovery/reissue procedure; datum-schema change control;
   incident-response runbook including § 748.1(c) 72-hour reporting.
5. **BSA program update:** amend the BSA/AML risk assessment and monitoring rules to
   cover CD-funding-account patterns; train staff; confirm OFAC address screening.
6. **Vendor due diligence files** for node infrastructure, wallet software, and
   credential tooling per 21-CU-16 / FFIEC outsourcing booklet.
7. **Member-facing legal drafting:** CD agreement addendum (token terms, key-loss
   allocation, core-ledger-controls clause), Part 707 disclosures, Part 740-compliant
   marketing review, E-SIGN consent flow, updated Reg P privacy notice.
8. **Independent security assessment** of the Plutus validator, minting policy, and
   oracle (code audit + key-management review) before any mainnet mint.
9. **Reconciliation and reporting build-out:** automated daily core-ledger ↔ on-chain
   reconciliation with exception escalation; audit-ready mint/burn reports for the
   supervisory committee.
10. **UCC/property-law papering:** state-by-state confirmation of Article 12 status in
    the pilot state; member agreement language fixing the token's legal character and
    the core ledger's priority.
11. **Insurance disclosures review:** confirm all "insured" language against Part 740
    with compliance counsel, including screenshots of every wallet/app surface where the
    token appears.
12. **Cyber-incident tabletop** covering oracle-key compromise, minting-policy exploit,
    and chain outage, exercising both the technical response and the 72-hour NCUA
    notification.

## Sources

- [Marine Bank v. Weaver, 455 U.S. 551 (1982)](https://supreme.justia.com/cases/federal/us/455/551/)
- [Reves v. Ernst & Young, 494 U.S. 56 (1990)](https://supreme.justia.com/cases/federal/us/494/56/)
- [SEC v. W.J. Howey Co., 328 U.S. 293 (1946)](https://supreme.justia.com/cases/federal/us/328/293/)
- [Gary Plastic Packaging Corp. v. Merrill Lynch, 756 F.2d 230 (2d Cir. 1985)](https://openjurist.org/756/f2d/230)
- [SEC, Commissioner Peirce, "Enchanting, but Not Magical: A Statement on the Tokenization of Securities" (July 9, 2025)](https://www.sec.gov/newsroom/speeches-statements/peirce-statement-tokenized-securities-070925)
- [Cooley, "Statement on Tokenized Securities" (Feb. 2026)](https://www.cooley.com/news/insight/2026/2026-02-04-statement-on-tokenized-securities)
- [Dechert, "SEC Staff Maps Tokenization Models" (Feb. 2026)](https://www.dechert.com/knowledge/onpoint/2026/2/sec-staff-maps-tokenization-models--tokenized-securities-are-sti.html)
- [SEC Chair Atkins, "American Leadership in the Digital Finance Revolution" (July 31, 2025)](https://www.sec.gov/newsroom/speeches-statements/atkins-digital-finance-revolution-073125)
- [SEC Chair Atkins, "The SEC's Approach to Digital Assets: Inside 'Project Crypto'" (Nov. 2025)](https://www.sec.gov/newsroom/speeches-statements/atkins-111225-secs-approach-digital-assets-inside-project-crypto)
- [NCUA Letter to Credit Unions 21-CU-16](https://ncua.gov/regulation-supervision/letters-credit-unions-other-guidance/relationships-third-parties-provide-services-related-digital-assets)
- [NCUA Letter to Credit Unions 22-CU-07](https://ncua.gov/regulation-supervision/letters-credit-unions-other-guidance/federally-insured-credit-union-use-distributed-ledger-technologies)
- [NCUA, Financial Technology and Digital Assets](https://ncua.gov/regulation-supervision/regulatory-compliance-resources/financial-technology-and-digital-assets)
- [12 CFR Part 740 (advertising accuracy)](https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-740) · [Part 745 (share insurance)](https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-745) · [Part 748 (security/BSA/safeguards)](https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-748) · [Part 707 (Truth in Savings)](https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-707) · [Part 715 (audits)](https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-715)
- [FDIC 12 CFR Part 328 (official signs and advertising; misrepresentation)](https://www.ecfr.gov/current/title-12/chapter-III/subchapter-B/part-328)
- [31 CFR § 1020.220 (CIP)](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1020/subpart-B/section-1020.220) · [§ 1010.230 (CDD)](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1010/subpart-B/section-1010.230) · [§ 1010.410 (recordkeeping/travel rule)](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1010/subpart-D/section-1010.410)
- [FinCEN/FRB, 2020 proposed travel-rule amendments](https://www.federalregister.gov/documents/2020/10/27/2020-23756/threshold-for-the-requirement-to-collect-retain-and-transmit-information-on-funds-transfers-and)
- [FinCEN, FIN-2019-G001 (CVC business models)](https://www.fincen.gov/resources/statutes-regulations/guidance/application-fincens-regulations-certain-business-models)
- [FFIEC IT Examination Handbook](https://ithandbook.ffiec.gov/) · [FFIEC Authentication Guidance (Aug. 2021)](https://www.ffiec.gov/guidance/Authentication-and-Access-to-Financial-Institution-Services-and-Systems.pdf)
- [Uniform Law Commission, 2022 UCC Amendments](https://www.uniformlaws.org/committees/community-home?CommunityKey=1457c422-ddb7-40b0-8c76-39a1991651ac) · [Orrick on New York's enactment](https://www.orrick.com/en/Insights/2025/12/New-York-Enacts-2022-UCC-Amendments-A-New-Era-for-Digital-Asset-Transactions)
- [CSBS Money Transmission Modernization Act](https://www.csbs.org/csbs-money-transmission-modernization-act-mtma)
- [GENIUS Act, S.1582 (119th Cong., enacted July 2025)](https://www.congress.gov/bill/119th-congress/senate-bill/1582) · [Richmond Fed, "Stablecoins and the GENIUS Act"](https://www.richmondfed.org/banking/banker_resources/news_flash/2025/20251118_genius_act)
- [15 U.S.C. § 7001 (E-SIGN)](https://www.law.cornell.edu/uscode/text/15/7001) · [15 U.S.C. § 6801 (GLBA)](https://www.law.cornell.edu/uscode/text/15/6801) · [12 U.S.C. § 1787 (share insurance)](https://www.law.cornell.edu/uscode/text/12/1787) · [12 U.S.C. § 1757 (FCU powers)](https://www.law.cornell.edu/uscode/text/12/1757) · [15 U.S.C. § 7262 (SOX § 404)](https://www.law.cornell.edu/uscode/text/15/7262)
- [PCI Security Standards Council](https://www.pcisecuritystandards.org/)
