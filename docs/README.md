# CDT documentation index

Start here if you are new to the repo.

| Document | Audience | Purpose |
| --- | --- | --- |
| **[Operator & demo manual](./manual.md)** | Engineers, CU ops, demos | Run the stack, use desks, env vars, smoke tests |
| **[Product position](./product-position.md)** | Product / leadership / desks | **CU login → buy CDT → Lace wallet** (canonical pitch) |
| [Whitepaper](./whitepaper.md) | Product / leadership | Full product thesis |
| [Architecture](./architecture.md) | Engineers | On-chain + off-chain design |
| [Compliance](./compliance.md) | Risk / compliance | CIP, BSA, NCUSIF framing |
| [Production readiness](./production-readiness.md) | Ops / pilot | What is shippable vs open |
| [Security audit](./security-audit.md) | Security | Findings + remediation status |
| [Why Cardano](./why-cardano.md) | Technical decision | eUTxO / native assets rationale |
| [Payment-check contract](./payment-check-contract.md) | Merchants / integrators | `cdt.payment_check.v1` |
| [Feasibility](./feasibility.md) | Planning | Technical feasibility notes |
| [Rollout](./rollout.md) | Program mgmt | Phased rollout |
| [Proposal](./proposal.md) / [Business plan](./business-plan.md) | Business | Commercial framing |

## Ops (pilot host)

| Document | Purpose |
| --- | --- |
| [Key ceremony](./ops/key-ceremony.md) | Generate PEMs, dual-control, remote signer |
| [Identus path mapping](./ops/identus-path-mapping.md) | Wire `HttpIdentusAgent` to a live agent |
| [On-chain deposit registry](./ops/on-chain-deposit-registry.md) | One-shot mint uniqueness design |
| [SC audit brief](./ops/sc-audit-brief.md) | Pre-audit package for external reviewers |

## Network settlement (multi-CU)

Legal/ops package under [`network/`](./network/README.md): master agreement, bilateral MOU, messaging protocol, fee schedule, board briefing.

Machine API: [`openapi/settlement-v1.yaml`](./openapi/settlement-v1.yaml) (also `GET /api/openapi.json` when webapp is running).

## Static demo snapshot

Open [`demo-dashboard.html`](./demo-dashboard.html) in a browser for a post-run overview (not a live desk).

## Root README

Repository overview and history: [`../README.md`](../README.md).
