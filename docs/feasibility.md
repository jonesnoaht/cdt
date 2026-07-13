# CDT Feasibility Study

**Project:** Certificate of Deposit Token (CDT)
**Author:** Noah Jones
**Status:** Working draft, prepared alongside the rebuilt prototype
**Related documents:** [Architecture](./architecture.md) · [Proposal](./proposal.md) · [Why Cardano](./why-cardano.md) · [Compliance](./compliance.md) · [Rollout strategy](./rollout.md)

---

## 1. Executive summary

CDT tokenizes certificates of deposit issued by a credit union — initially
CampusUSA Credit Union (Gainesville, FL), which reviewed the concept in July
2021 and asked for a working demonstration — as native assets on Cardano. Each
CD's terms (principal, rate in basis points, start, maturity, early-withdrawal
penalty) live in an on-chain datum; minting is gated by an oracle co-signature
that attests a matching deposit exists in the credit union's core ledger.

This study asks four questions and answers them honestly:

| Dimension | Verdict | Confidence |
| --- | --- | --- |
| Technical | Feasible; core mechanism proven on emulator, integration unproven | Medium-high |
| Operational | Feasible for a credit union with a small dedicated team plus vendors | Medium |
| Economic | Feasible; costs are dominated by people and audits, not by chain fees | Medium-high |
| Regulatory | Conditionally feasible; see [docs/compliance.md](./compliance.md) | Medium |

The market context has also shifted in CDT's favor since 2021: tokenized
deposits went from a research topic to an industry roadmap item, with a
[projected market of $4.8B in 2025 growing toward $38.6B by 2034](https://dataintelo.com/report/tokenized-deposits-market),
[multi-bank pilots in the UK and a five-bank US regional consortium (Cari Network)](https://www.techmagazines.net/tokenized-deposits-are-bankings-biggest-bet-of-2026-and-the-race-has-already-started/),
and [Citi projecting broad tokenization of real-world instruments by 2030](https://www.citigroup.com/rcs/citigpa/storage/public/Citi_Institute_GPS_Report_Tokenization_2030.pdf).
A credit union CD is a small, well-bounded instrument — a sensible first
tokenization target precisely because it is boring.

## 2. Technical feasibility

### 2.1 What the prototype already proves

The rebuilt prototype (see [docs/architecture.md](./architecture.md)) runs the
full CD lifecycle deterministically on the Lucid Evolution **local emulator**:

1. **Deposit** — a simulated member deposit is recorded in the Postgres
   bank-core simulator (double-entry ledger tables standing in for the real
   core).
2. **Attest** — an oracle service reads the core record and co-signs the mint
   transaction; the Aiken mint validator rejects any mint lacking the oracle
   signature, and the vault validator locks the CD datum
   (`principal`, `rate_bps`, `start`, `maturity`, `penalty_bps`).
3. **Mint** — the CD token is issued to the member's address.
4. **Mature and redeem** — after the maturity slot, redemption pays principal
   plus interest computed from the datum.
5. **Early withdrawal** — before maturity, redemption succeeds only with the
   penalty applied, enforced by the validator, not by off-chain convention.

This proves the parts that were genuinely uncertain in 2021: that CD terms can
be encoded and enforced on-chain with the eUTxO model, that an
oracle-co-signature pattern can bind minting to an off-chain ledger event, and
that the whole flow can be scripted end-to-end in TypeScript. It also proves
the demo artifact CampusUSA asked for exists and is reproducible on a laptop.

Mock DID/VC credentials model the trust chain (NCUA → credit union → member),
demonstrating the shape of identity verification even though the production
path (Hyperledger Identus) is not yet wired in.

### 2.2 What remains unproven

**Real core-banking integration.** This is the largest open risk. The
prototype's Postgres simulator is a stand-in; the 2021 project notes already
flagged that most depository institutions run their core on IBM DB2 / z/OS
mainframes or on hosted third-party cores (Fiserv, Jack Henry Symitar,
Corelation KeeStone are common in the credit union market). Integration
realities we have not yet touched:

- The core may expose only nightly batch files or a vendor-managed API
  gateway, not the low-latency read the oracle currently assumes.
- Attestation must be transactional with the core posting (a deposit reversed
  in the core after a token minted on-chain is a reconciliation incident).
- CampusUSA's specific core vendor, API surface, and change-control process
  are unknown until a technical discovery engagement happens. Phase 1 of the
  [rollout plan](./rollout.md) is scoped to force this discovery early.

**Oracle key management.** The emulator uses a single in-memory signing key.
Production requires HSM- or KMS-backed keys, rotation procedures, a
compromise-response plan, and (by Phase 3) a federated multi-signature oracle
so no single key can authorize a mint. The cryptography is off-the-shelf; the
operational discipline is the unproven part.

**Wallet UX for non-crypto members.** Credit union members overwhelmingly do
not hold Cardano wallets and should never be asked to manage a seed phrase to
buy a CD. The plan (Phase 3) is a custodial or embedded-wallet option where
the credit union or a qualified vendor holds keys on the member's behalf, with
self-custody as an opt-in for sophisticated members. No prototype of this
exists yet; it is deliberately deferred because it is a product/UX problem,
not a protocol problem.

**Chain throughput — a non-issue, quantified.** CDs are the opposite of a
high-frequency workload. A credit union issuing 5,000 CDs per year generates
roughly 10,000–15,000 transactions per year (mint, redeem, occasional early
withdrawal) — about 0.0004 transactions per second. Cardano sustains orders
of magnitude more. Throughput can be struck from the risk list; finality
latency (~minutes) is also acceptable for an instrument with a term measured
in months.

### 2.3 Technical feasibility verdict

The consensus-layer and smart-contract questions are answered. The remaining
technical risk is concentrated in integration and key operations — both are
engineering-management problems with known solution patterns, not research
problems. **Feasible**, contingent on a successful core-integration discovery
in Phase 1.

## 3. Operational feasibility

### 3.1 Staffing

Minimum viable team through Phase 2 (roles, not necessarily headcount — some
combine):

| Role | Phase 1 | Phase 2 | Phase 3 | Notes |
| --- | --- | --- | --- | --- |
| Smart contract / off-chain engineer | 1 | 1 | 1–2 | Aiken + TypeScript |
| Integration engineer (core banking) | 0.5 | 1 | 1 | Likely paired with core vendor |
| DevOps / SRE (oracle + infra) | 0.5 | 1 | 1–2 | On-call from Phase 2 |
| Product / project lead | 0.5 | 0.5 | 1 | Interface to credit union board |
| Compliance liaison | 0.25 | 0.5 | 0.5 | See [compliance doc](./compliance.md) |
| Member support (trained staff) | 0 | 1–2 | scale w/ members | Existing CU staff, trained |

### 3.2 Oracle operations

The oracle is the only component whose failure blocks business: no oracle, no
new CDs (existing tokens still redeem, by design, if validators are written to
check maturity against chain time rather than a live oracle — the current
validators follow this pattern for redemption). Requirements:

- 24/7 availability target of 99.5% initially (an outage delays issuance; it
  does not endanger funds), monitored with alerting from Phase 1.
- Runbooks before Phase 2: key compromise, core-API outage, chain
  fork/rollback handling, stuck-transaction recovery, reconciliation-mismatch
  escalation.
- Daily automated reconciliation between the core ledger and on-chain state,
  with any mismatch paging a human.

### 3.3 Member support and incident handling

- Support scripts for the top predictable issues: "where is my CD token,"
  early-withdrawal requests, beneficiary/estate cases, lost credentials
  (custodial recovery path required).
- Incident severity matrix agreed with the credit union before any member
  funds are involved (Phase 2 gate).
- Member-facing education material is part of the
  [communication plan in the rollout doc](./rollout.md).

**Verdict: feasible.** The load resembles running one additional small online
banking channel, which credit unions already do; the novel parts (oracle,
reconciliation) are automatable.

## 4. Economic feasibility

### 4.1 Development cost model (person-months)

Assuming a blended fully-loaded cost of $12k–$18k per person-month (mix of
senior contract engineers and CU staff time; US market, 2025–26):

| Phase | Scope | Person-months | Cost range |
| --- | --- | --- | --- |
| 0 (done) | Emulator prototype, docs | ~3 | Sunk |
| 1 | Preview-testnet pilot, core-API discovery, monitoring | 6–9 | $72k–$162k |
| 2 | Member beta: allowlisting, caps, support tooling, runbooks | 8–12 | $96k–$216k |
| 3 | Production: custodial wallet, Identus, federated oracle, audit remediation | 12–18 | $144k–$324k |
| **Total (1–3)** | | **26–39** | **~$310k–$700k** |

These are estimates with wide bars on purpose; the Phase 1 discovery will
narrow Phase 2–3 numbers and is itself a go/no-go input.

### 4.2 Infrastructure

Two viable postures:

- **API provider (recommended through Phase 2).**
  [Blockfrost offers a free tier and paid plans](https://blockfrost.io/) with
  usage-based scaling; at CDT's transaction volumes even paid tiers are on the
  order of tens-to-low-hundreds of dollars per month. Zero node-ops burden.
- **Self-hosted (Phase 3 option).** A Cardano node + Ogmios/Kupo stack runs
  comfortably on two redundant VMs (~8 vCPU, 32 GB RAM each), roughly
  $300–$800/month cloud spend plus SRE time. Self-hosting removes a
  third-party dependency, which the credit union's vendor-risk review may
  eventually prefer.

Oracle infrastructure (small service + HSM/KMS): cloud KMS usage is
single-digit dollars/month; a dedicated CloudHSM-class device, if required by
the security review, is roughly $1k–$2k/month. Postgres, monitoring, and CI
are conventional and minor.

### 4.3 Transaction fees — quantified and negligible

Cardano fees follow `a × size(tx) + b`
([fee structure](https://docs.cardano.org/about-cardano/explore-more/fee-structure));
a simple transaction costs about
[0.16–0.2 ADA](https://solberginvest.com/blog/cardano-fees/), with the USD
cost tracking ADA's price. Script-bearing CDT transactions are larger —
budget a conservative 0.5 ADA each, and a conservative 3 transactions per CD
(mint, one exit — redemption *or* early withdrawal — plus margin for retries
and datum updates). At 5,000 CDs/year that is an upper bound of 15,000
tx/year ≈ **7,500 ADA per year — roughly $4k–$15k across the ADA price range
of recent years, under 0.03% of the principal of a modest $50M CD book even
at the high end**. Fees are not a factor in the business case. (ADA price
exposure for fee payment is trivial at this size; a small treasury buffer
suffices.)

### 4.4 Audits and legal

- **Smart-contract audit.** Market pricing in 2025–26 spans roughly
  [$5k–$250k, with most protocol audits at $25k–$100k](https://sherlock.xyz/post/smart-contract-audit-cost);
  simple token/vault codebases sit at the
  [low end of that range](https://www.cyberscope.io/blog/how-much-does-it-cost-to-audit-a-smart-contract).
  CDT's two small validators should land near **$25k–$60k** for a reputable
  Cardano-capable firm, plus $5k–$20k per re-audit round after remediation.
  Budget one audit before Phase 2 (scoped) and a full audit before Phase 3.
- **Legal / regulatory counsel.** Securities and NCUA analysis (see
  [compliance doc](./compliance.md)): budget $30k–$80k across Phases 1–3.
- **Penetration test of off-chain services** before Phase 2: $15k–$40k.

### 4.5 Revenue-side context

The point of CDT is not fee revenue; it is deposit growth and product
differentiation. With the
[national average 1-year CD at ~1.65% APY while top offers reach ~4.1%](https://www.nerdwallet.com/banking/best/1-year-cd-rates),
CDs are a rate-competition product where a credit union with lower servicing
costs and a distinctive product can win deposits. A tokenized CD also opens a
path (post-Phase 3, with regulatory approval) to secondary-market liquidity —
the long-term differentiator. The economic case closes if Phases 1–3
(~$310k–$700k plus ~$100k–$200k audits/legal/infra) is affordable as a
strategic technology investment for the institution; for a mid-sized credit
union this is comparable to one core-adjacent digital-banking project.

## 5. Regulatory feasibility

Regulatory analysis is owned by [docs/compliance.md](./compliance.md) and is
summarized here in one paragraph: the NCUA has stated that
[federally insured credit unions are not prohibited from using distributed ledger technology](https://ncua.gov/regulation-supervision/letters-credit-unions-other-guidance/federally-insured-credit-union-use-distributed-ledger-technologies)
(Letter 22-CU-07) provided the underlying activity is permissible and sound
risk management is applied, which makes CDT's posture — DLT as the recording
technology for an ordinary share certificate, with share-insurance treatment,
securities-law analysis, BSA/AML, and third-party risk handled as the
compliance doc details — plausible but requiring early, documented NCUA
engagement and board approval before any member funds are involved. Every
phase gate below therefore includes a regulatory condition.

## 6. Risk register

Likelihood and impact: L(ow) / M(edium) / H(igh).

| # | Category | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- | --- |
| R1 | Technical | Core-banking integration infeasible or vendor blocks API access | M | H | Phase 1 discovery before member commitments; batch-file fallback design; engage core vendor early |
| R2 | Technical | Validator bug allows improper mint/redeem | L | H | Small audited codebase; property tests on emulator; caps in Phase 2 limit blast radius |
| R3 | Custody | Oracle signing key compromise → unauthorized mints | L–M | H | HSM/KMS, rotation, monitoring for unexpected mints, federated multisig in Phase 3, incident runbook |
| R4 | Custody | Member loses self-custody keys / seed phrase | M | M | Custodial wallet default; self-custody opt-in with recovery education; core ledger remains source of truth for the underlying deposit |
| R5 | Regulatory | NCUA or state supervisor objects; securities characterization adverse | M | H | Early briefings, non-transferable tokens in beta, legal opinion before Phase 2; see compliance doc |
| R6 | Counterparty | API provider (Blockfrost) or core vendor outage/discontinuation | M | M | Redundant provider or self-hosted node path; issuance degrades gracefully, redemption unaffected |
| R7 | Counterparty | ADA price volatility affects fee treasury | H | L | Fee costs are trivial (§4.3); keep small buffer |
| R8 | Adoption | Members don't want tokenized CDs; wallet friction | M | M | Custodial UX, identical rates + small pilot perk, treat Phase 2 uptake as an explicit metric, cheap to stop |
| R9 | Operational | Reconciliation mismatch between core and chain | M | M | Daily automated reconciliation with paging; mint only after core posting is final |
| R10 | Technical | Cardano protocol change breaks validators/off-chain | L | M | Pin protocol versions in CI; monitor hard-fork schedule; emulator regression suite |
| R11 | Reputational | Public incident during beta damages CU brand | L–M | H | Small caps, staff-first pilot, prepared comms plan (rollout doc §communication) |

## 7. Go / no-go criteria by phase gate

Phases are defined in [docs/rollout.md](./rollout.md). Each gate requires
**all GO criteria** met; any NO-GO condition halts progression.

### Gate A — enter Phase 1 (preview testnet, internal)

- GO: emulator demo runs end-to-end reproducibly (met, Phase 0); credit union
  sponsor identified; Blockfrost/testnet access provisioned; budget for
  Phase 1 approved.
- NO-GO: credit union declines a technical-discovery engagement on its core
  system.

### Gate B — enter Phase 2 (limited member beta)

- GO: Phase 1 success metrics met (rollout doc); core-integration design
  validated against the *actual* core vendor's interface (read path at
  minimum); scoped smart-contract audit complete with criticals remediated;
  penetration test passed; runbooks written and drilled once; legal opinion on
  securities/share-certificate treatment delivered; board approval and NCUA
  briefing completed; per-member and aggregate caps set.
- NO-GO: unremediated critical audit finding; adverse legal opinion; NCUA
  supervisory objection; core vendor refuses any integration path.

### Gate C — enter Phase 3 (production)

- GO: Phase 2 ran ≥ one full CD maturity cycle with zero reconciliation
  discrepancies and zero fund-loss incidents; member CSAT and support load
  within targets; full audit of final code; federated oracle (≥3-of-n) operational;
  custodial wallet vendor contracted and reviewed under third-party risk
  policy; Identus credential issuance replacing mocks; monitoring/alerting SLOs
  met for 90 consecutive days; regulator engagement current.
- NO-GO: any unexplained on-chain/core mismatch during beta; audit criticals;
  withdrawal of board or regulator support; beta adoption below the floor set
  at Gate B (signal to stop cheaply rather than scale).

## 8. Conclusion

CDT is technically feasible today at demo scale — the emulator prototype
proves the contract mechanics CampusUSA asked to see. The path to production
runs through three well-understood but real hurdles: integrating with an
actual banking core, operating oracle keys with institutional discipline, and
obtaining regulatory comfort. None is a research problem; all are gated
explicitly above so that the project can stop cheaply at any point where the
answer turns out to be no. The recommended next step is Gate A: fund Phase 1
and schedule the core-systems discovery with CampusUSA.

---

*Sources: [Sherlock audit pricing](https://sherlock.xyz/post/smart-contract-audit-cost) · [Cyberscope audit cost guide](https://www.cyberscope.io/blog/how-much-does-it-cost-to-audit-a-smart-contract) · [Cardano fee structure](https://docs.cardano.org/about-cardano/explore-more/fee-structure) · [Cardano fee levels](https://solberginvest.com/blog/cardano-fees/) · [Blockfrost](https://blockfrost.io/) · [NerdWallet 1-year CD rates](https://www.nerdwallet.com/banking/best/1-year-cd-rates) · [NCUA Letter 22-CU-07](https://ncua.gov/regulation-supervision/letters-credit-unions-other-guidance/federally-insured-credit-union-use-distributed-ledger-technologies) · [Tokenized deposits market report](https://dataintelo.com/report/tokenized-deposits-market) · [Citi GPS: Tokenization 2030](https://www.citigroup.com/rcs/citigpa/storage/public/Citi_Institute_GPS_Report_Tokenization_2030.pdf)*
