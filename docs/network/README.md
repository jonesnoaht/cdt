# CDT Settlement Network — Document Package

**Version:** 0.1  
**Date:** July 2026  
**Author:** Noah Jones  
**Status:** Working drafts for counsel and pilot partners — not executed legal instruments  

> **Disclaimer.** These materials are planning and negotiation aids for the
> Certificate of Deposit Token (CDT) prototype. They are **not** legal advice,
> not an offer of securities or deposit products, and not a substitute for
> engagement of banking counsel, the NCUA (or state supervisors), or each
> credit union’s board and compliance function. Any real pilot requires
> formal legal drafting and regulatory engagement.

## Purpose of this package

Explain and contractually bootstrap a network in which:

1. An **issuing credit union** tokenizes share certificates as CDTs.  
2. A **holder** may present a CDT at **any participating credit union**.  
3. The redeeming CU **credits the holder** (cash or account transfer).  
4. The **issuer settles** with the redeeming CU after **claim verification** and
   **burn** (or issuer-controlled cancel) of the CDT.  

Money for the original insured deposit stays on the **issuer’s** books until
paid out; the token is a portable receipt; free transfer of the token does not
by itself retitle NCUSIF coverage.

## Document index

| # | Document | Audience |
| --- | --- | --- |
| — | **[Business proposal](./business-proposal.md)** | CU CEOs, boards, CUSOs, partners |
| 01 | [Master Network Agreement — term sheet](./01-master-network-agreement.md) | Counsel, network operator |
| 02 | [Bilateral pilot MOU](./02-bilateral-mou.md) | First issuer + first redeemer |
| 03 | [Member terms addendum (network redeem)](./03-member-terms-addendum.md) | Issuing CU members |
| 04 | [Presentment & burn authorization](./04-presentment-burn-authorization.md) | Teller / digital capture |
| 05 | [Messaging & API protocol](./05-messaging-protocol.md) | Engineering + vendors |
| 06 | [Operating procedures](./06-operating-procedures.md) | Ops, BSA, treasury |
| 07 | [Fee schedule (draft)](./07-fee-schedule.md) | Finance, network |
| 08 | [Board briefing (one-pager)](./08-board-briefing.md) | Credit union boards |
| 09 | [Risk & compliance memo](./09-risk-and-compliance-memo.md) | CRO, BSA, counsel |

## Related project docs

- [Whitepaper](../whitepaper.md)  
- [Business proposal (product / CampusUSA)](../proposal.md)  
- [Business plan (company)](../business-plan.md)  
- [Compliance analysis](../compliance.md)  
- [Architecture](../architecture.md)  
- [Payment-check contract](../payment-check-contract.md) (merchant opt-in verify; distinct from CU settlement)  
- [Rollout strategy](../rollout.md)  

## Bootstrap sequence (summary)

```
Phase 0  Paper MOU (2 CUs) + manual burn + wire
Phase 1  Bilateral API + ACH + member T&Cs
Phase 2  Multilateral Master Agreement + CUSO hub
Phase 3  Same-day rails + merchant payment-check at scale
```

## Repository demo surfaces

| Flow | Webapp route (prototype) |
| --- | --- |
| Issuing desk — tokenize | `#/open` |
| Correspondent desk — foreign cash-out | `#/present` |
| Merchant payment-check (free-spend verify) | `#/pay` |
