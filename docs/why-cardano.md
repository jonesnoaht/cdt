# Why Cardano

The original 2021 project notes set this document as a requirement: *"Explain
why Cardano was the best choice, and compare to alternatives in a matrix."*
This is that comparison, updated with the facts as of mid-2026 and written to
be honest about the trade-offs — including the ones that hurt this project.

The product being evaluated is narrow and unusual by blockchain standards: a
**regulated, low-frequency, high-assurance instrument** (a certificate of
deposit). It mints rarely, transfers rarely, and redeems once. It does not
need high throughput or a deep DeFi ecosystem. It needs deterministic
settlement, predictable costs, a defensible audit story, and an identity
layer that regulators can reason about. That framing drives every row below.

## Comparison matrix

| Criterion | Cardano | Ethereum L1/L2 | Solana | Hyperledger Fabric (permissioned) | No blockchain (database) |
| --- | --- | --- | --- | --- | --- |
| **Settlement finality / determinism** | eUTxO: transaction outcome is fully determined before submission — it either applies exactly as built or fails without side effects ([Cardano docs](https://developers.cardano.org/docs/learn/core-concepts/eutxo/)) | Account model: outcome can depend on state at execution time; a transaction can land differently than simulated, or revert while still consuming gas. L2s add a settlement delay to L1 finality | Fast optimistic confirmation; account model shares Ethereum's execution-time nondeterminism. Historical liveness failures (multiple outages 2021–2023, none since Firedancer client diversity in 2024+) ([comparison](https://coinlaw.io/solana-vs-ethereum-statistics/)) | Deterministic by design; ordering service controlled by consortium | Fully deterministic — it's a database. "Finality" is whatever the DBA says it is |
| **Fee predictability** | Fees computed exactly from transaction size/execution units before signing; no congestion auctions ([developer portal](https://developers.cardano.org/docs/learn/core-concepts/eutxo/)) | L1 gas auctions are volatile; L2 fees are now very low (avg. major-L2 fee fell ~99% post-Dencun to fractions of a cent by Q1 2026, [arXiv study](https://arxiv.org/html/2606.22206v1)) but still float with blob-market demand | Very low per-transaction fees; priority-fee market emerges under load | No fees (infrastructure cost only) | No fees (infrastructure cost only) |
| **Native assets without smart-contract risk** | Tokens are ledger-native: minting needs a policy script, but holding/transfer needs no token contract at all — no ERC-20-style contract to exploit ([native assets docs](https://developers.cardano.org/docs/learn/core-concepts/assets/)) | Tokens are contracts (ERC-20 etc.); every token inherits contract-bug and upgrade-key risk | SPL token program is shared/audited, but tokens still live inside a program, not the ledger core | Chaincode-defined assets; consortium-audited, contract risk exists but inside a permissioned boundary | N/A — rows in a table |
| **Formal-methods culture** | Ouroboros consensus published and peer-reviewed; specification-first development culture; on-chain code (Plutus/Aiken) compiles to a small, well-specified core language ([Plutus docs](https://docs.cardano.org/developer-resources/smart-contracts/plutus)) | Strong academic ecosystem and mature audit industry, but the EVM itself grew by accretion; formal verification is available, not default | Engineering-velocity culture; formal methods not a design center | Solid engineering; correctness relies on consortium code review rather than adversarial review | Formal methods rarely applied; correctness rests on testing and vendor trust |
| **eUTxO auditability** | Every CD is a discrete UTxO with its terms in the datum: an examiner can enumerate all outstanding certificates and their exact terms from the ledger alone, without replaying contract state | Requires reading contract storage / event logs and trusting indexing infrastructure to reconstruct state history | Same class of problem as Ethereum: state lives in program accounts; history requires indexers | Excellent *for the consortium*: full history visible to permissioned members, invisible to outsiders — third-party verifiability is weaker | Auditable only via the institution's own records and its auditors — exactly the status quo the CDT improves on |
| **Identity story (Identus)** | [Hyperledger Identus](https://www.lfdecentralizedtrust.org/projects/identus) (Linux Foundation Decentralized Trust) issues W3C DIDs/VCs using **Cardano as the verifiable data registry** — a first-party fit for the NCUA → credit union → member credential chain ([IOG](https://www.iog.io/news/hyperledger-identus-then-now-and-tomorrow)) | Several DID methods (e.g., did:ethr) and a broad SSI ecosystem, but no single flagship stack with equivalent institutional stewardship | Identity tooling exists but is not a core ecosystem focus | Strong: Fabric grew up next to Hyperledger identity projects (Indy/Aries lineage); natural in consortium settings | Conventional IAM/KYC systems — mature, but attestations are not portable or independently verifiable |
| **Energy / ESG** | Proof of stake; entire network estimated around 0.6 GWh/yr — negligible per transaction ([Essential Cardano](https://www.essentialcardano.io/article/comparison-of-energy-consumption-of-cardano-and-bitcoin), [CCRI-linked reporting](https://cexplorer.io/energy)) | Proof of stake since the Merge; similarly low footprint | Proof of stake/history; low footprint per transaction | Minimal — a handful of consortium nodes | Minimal — ordinary servers |
| **Ecosystem maturity** | **Weakest row.** DeFi TVL ~$132M in early 2026 vs. Ethereum ~$53B and Solana ~$4B+; smaller developer pool; eUTxO expertise scarce ([MEXC ecosystem review](https://www.mexc.com/learn/article/top-cardano-defi-projects-in-2026-where-is-the-tvl-going-/1)) | Deepest liquidity, largest audit/tooling/talent market, most institutional tokenization precedent | Large, fast-growing ecosystem; strong retail and payments traction | Mature in enterprise; declining mindshare vs. public-chain tokenization since ~2023 | Infinitely mature — every bank already runs one |
| **Regulatory perception** | Clean-by-design narrative (peer review, PoS, no US enforcement history comparable to majors); smaller body of regulatory precedent to point to | Most institutional and regulatory engagement of any public chain; post-GENIUS-Act tokenization frameworks are largely being prototyped on Ethereum rails | Improving institutionally; historical outage record still appears in risk assessments | Historically the *default* regulator-friendly answer: permissioned, no token, full control | No perception issue at all — and no independent verifiability either |

## Honest assessment of Cardano's weaknesses

A proposal that hides these would not survive due diligence:

- **Throughput is limited.** Cardano L1 processes on the order of single-digit
  to low-double-digit TPS in practice; scaling depends on a roadmap (Hydra
  heads, Ouroboros Leios, Midgard rollups) that is real but not finished
  ([Coin Bureau 2026 review](https://coinbureau.com/review/cardano-review)).
  *Mitigation: a CD product mints and redeems at human timescales; base-layer
  throughput is not a binding constraint for this instrument.*
- **The DeFi ecosystem is small.** ~$132M TVL ranks Cardano around 27th among
  chains in early 2026, and daily fee revenue is a rounding error next to
  Ethereum's or Solana's ([data](https://www.mexc.com/learn/article/top-cardano-defi-projects-in-2026-where-is-the-tvl-going-/1)).
  If the long-term vision includes secondary-market liquidity for CDTs, the
  venue liquidity is not there today and may need to be built or bridged.
- **Tooling churn is real — this repository is the proof.** The project's
  2021 codebase (Plutus V1-era Haskell contracts and the original PAB
  architecture) rotted to unbuildable as the ecosystem moved through Plutus
  versions, abandoned the PAB, and coalesced on new stacks. The rebuild on
  Aiken and Lucid Evolution is dramatically more pleasant, but a fiduciary
  should assume further churn and budget maintenance accordingly.
- **Scarce specialist talent.** eUTxO design patterns and Aiken/Plutus skills
  are much rarer than Solidity or conventional-database skills, which raises
  key-person risk and audit cost.
- **Thinner regulatory precedent.** Ethereum has the majority of institutional
  tokenization pilots; choosing Cardano means writing more of the compliance
  narrative ourselves rather than citing peers.

## Why Cardano still wins for this instrument

Weigh the matrix by what a CD actually needs and the answer stops being
close:

1. **eUTxO determinism is the product feature.** A CD is a fixed-term
   contract whose entire value is that its terms cannot drift. On Cardano,
   the transaction that redeems a CD is validated deterministically against a
   datum that contains the terms — what you simulate is what settles, and
   fees are known before signing. For a regulated institution, "the
   transaction cannot do anything other than what compliance reviewed" is not
   a nicety; it is the approval condition.
2. **Native assets remove a whole risk class.** The CDT itself is a
   ledger-level asset, not a token contract. There is no upgradeable ERC-20,
   no owner key, no reentrancy surface on the asset itself — the remaining
   contract risk is concentrated in one small vault validator and one minting
   policy, which is a tractable audit scope.
3. **The credential ecosystem is first-party.** The NCUA → credit union →
   member trust chain is the heart of this design, and Identus — a Linux
   Foundation-stewarded stack that uses Cardano as its verifiable data
   registry — is the most direct production path for it. On other chains this
   layer would be assembled from third-party parts.
4. **The weaknesses don't bind.** Low throughput, small DeFi TVL, and thin
   NFT/retail activity are the costs Cardano pays for its design choices —
   and a low-frequency, high-assurance deposit instrument doesn't consume any
   of the things Cardano is short of.

## The fallback, and how the architecture protects it

A **permissioned chain (Hyperledger Fabric or similar) remains a viable
fallback**, and for some boards it will be the required first step: it offers
determinism, zero fees, and total institutional control, at the price of
giving up exactly the property that motivates the CDT — *independent*,
third-party verifiability of the member's certificate without trusting the
institution's own infrastructure. A Fabric deployment would make the CDT a
better core-banking module; a public-chain deployment makes it a better
*certificate*.

The system is built so that this decision is reversible. Chain-specific code
is isolated behind narrow seams: the on-chain layer is two small artifacts (a
vault validator and a minting policy, in Aiken), and the off-chain oracle
watcher talks to the chain through a single provider interface (Lucid
Evolution) while its deposit-verification and credential-verification logic
is chain-agnostic TypeScript against Postgres and W3C-standard VCs. Porting
to a permissioned ledger — or to a future Cardano partner chain — means
re-implementing the thin on-chain layer and one adapter, not the system.

**Conclusion:** for a certificate of deposit — regulated, low-frequency,
high-assurance — eUTxO determinism, ledger-native assets, and the Identus
credential ecosystem line up with the product's requirements more precisely
than any alternative, and the alternatives' advantages (throughput, DeFi
depth) are advantages this product cannot use. Cardano is the right primary
target, chosen with eyes open, with a permissioned fallback that the
architecture keeps cheap.
