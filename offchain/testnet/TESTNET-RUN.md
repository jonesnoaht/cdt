# CDT preview-testnet run

Verifiable evidence of the full Certificate of Deposit Token (CDT) lifecycle
executed on the **Cardano preview testnet** (real network, not an emulator).
Every transaction hash below is confirmable on-chain.

- Run date: 2026-07-14T01:21:32.052Z
- Network: preview (slot length 1 s)
- Provider: Koios public preview endpoint (`https://preview.koios.rest/api/v1`)
- Explorer: <https://preview.cardanoscan.io>

## Parties (public addresses)

| Role | Address | Payment vkh |
|------|---------|-------------|
| Issuer (credit union) | `addr_test1vzv3cmaamzy4dyxxkk9nwk5u627x20qkaprlkdp4ppny7hgxv4lrv` | `991c6fbdd8895690c6b58b375a9cd2bc653c16e847fb343508664f5d` |
| Member (CD owner) | `addr_test1vzt4pgx2a0rcwm75k3daq6yva0enhefxkqduy3d6p29tthg8ay00x` | `9750a0caebc7876fd4b45bd0688cebf33be526b01bc245ba0a8ab5dd` |
| Oracle (deposit attestor) | `addr_test1vz39mjg938w39r5nwwlt0m34tqm8pcuhke9yln5rp0rzexc9y0208` | `a25dc90589dd128e9373beb7ee35583670e397b64a4fce830bc62c9b` |

## Scripts

- CDT policy id: `5415141c1a309d88a041d9fdaa1484dc471f7c84b179f372fda75fce`
- Vault script hash: `a1bd8ecb9e448b2311c3970b8982bb9155911b9f70dc9c345cb2cfdf`
- Vault address: `addr_test1wzsmmrktnezgkgc3cwtshzvzhwg4tygmnacde8p5tjevlhc8ftf8f`
- Blueprint: `onchain/plutus.json` (Aiken, Plutus v3), mint policy parameterized by `(oracle_vkh, vault_hash)`

## Funding

The issuer wallet was funded from the official preview faucet (<https://docs.cardano.org/cardano-testnets/tools/faucet>) and distributed working balances to the member and oracle wallets (`npm run fund`).

- Faucet grant to issuer (10,000.2 tADA): [`ac7e5e94cbc27d39fc1f1798ffc9ed085f52edf7651cc57dfd180578daccc9dc`](https://preview.cardanoscan.io/transaction/ac7e5e94cbc27d39fc1f1798ffc9ed085f52edf7651cc57dfd180578daccc9dc)
- Issuer distribution (member 200 tADA, oracle 10 tADA): [`96782ff91689da64f6dbae3c90f10259f957fac15ba5146ef0ffbf3580944a4e`](https://preview.cardanoscan.io/transaction/96782ff91689da64f6dbae3c90f10259f957fac15ba5146ef0ffbf3580944a4e)

## CD 1: `TESTNET-20260714-0121-001` (redeemed at maturity)

| Term | Value |
|------|-------|
| Principal | 100.000000 tADA (100000000 lovelace) |
| Rate | 450 bps |
| Start | 2026-07-14T01:21:32.053Z (1783992092053) |
| Maturity | 2026-07-14T01:33:32.053Z (1783992812053) |
| Penalty | 1000 bps of accrued interest |
| CDT unit | `5415141c1a309d88a041d9fdaa1484dc471f7c84b179f372fda75fce544553544e45542d32303236303731342d303132312d303031` |
| Locked at vault | 100.000102 tADA (100000102 lovelace = principal + full interest) |

- Mint (issuer funds vault with principal + interest + the CDT, oracle co-signs): [`bd0e93a61bb5734915362dc6c0b51170a66b146f79055b23ddbaf1cda8b81c52`](https://preview.cardanoscan.io/transaction/bd0e93a61bb5734915362dc6c0b51170a66b146f79055b23ddbaf1cda8b81c52)
- Redeem at maturity (member burns CDT, receives principal + full interest): [`05342899345bd2d6021573f9dced18665912ea770c29192cbc12ee1055059f7c`](https://preview.cardanoscan.io/transaction/05342899345bd2d6021573f9dced18665912ea770c29192cbc12ee1055059f7c)

  - Tx validity lower bound: 2026-07-14T01:33:33.000Z (>= maturity, slot-aligned)
  - Payout to member: **100000102 lovelace** (100.000102 tADA)
  - Member tx fee: 310088 lovelace
  - Observed member balance delta: 99690014 lovelace (= payout - fee: 99690014)

## CD 2: `TESTNET-20260714-0121-002` (early withdrawal with penalty)

| Term | Value |
|------|-------|
| Principal | 100.000000 tADA (100000000 lovelace) |
| Rate | 450 bps |
| Start | 2026-07-14T01:34:38.296Z (1783992878296) |
| Maturity | 2027-07-14T01:34:38.296Z (1815528878296) |
| Penalty | 1000 bps of accrued interest |
| CDT unit | `5415141c1a309d88a041d9fdaa1484dc471f7c84b179f372fda75fce544553544e45542d32303236303731342d303132312d303032` |
| Locked at vault | 104.496919 tADA (104496919 lovelace = principal + full interest) |

- Mint (issuer funds vault with principal + interest + the CDT, oracle co-signs): [`8bc9b39aeb03b2c041014a839b82b2bb2d6a865aff36be1f023d6090688e0b08`](https://preview.cardanoscan.io/transaction/8bc9b39aeb03b2c041014a839b82b2bb2d6a865aff36be1f023d6090688e0b08)
- Early withdrawal (member burns CDT before maturity): [`603a936eb23c2b09ef3a19e2806dbde0e3bc11785c8fb07997ed7d7efd41b72e`](https://preview.cardanoscan.io/transaction/603a936eb23c2b09ef3a19e2806dbde0e3bc11785c8fb07997ed7d7efd41b72e)

  - Effective withdrawal time (tx validity lower bound): 2026-07-14T01:35:14.000Z
  - Accrued interest at withdrawal: 5 lovelace
  - Penalty withheld (1000 bps of accrued): 0 lovelace
  - Payout to member: **100000005 lovelace** (principal + accrued - penalty)
  - Remainder returned to issuer: **4496914 lovelace** (observed issuer delta: 4496914 lovelace)
  - Member tx fee: 316957 lovelace
  - Observed member balance delta: 99683048 lovelace (= payout - fee: 99683048)

## Deviations

Two earlier partial runs during development also left (harmless, throwaway)
artifacts on-chain; they are listed here for completeness and because they
motivated fixes that are part of the committed scripts:

1. **Aborted run 1** — CD `TESTNET-20260714-0046-001` was minted
   ([`97f7aba1fbde7188ecc74cf5415aec4f3d11be813c2f9b0c50dda967b866b14c`](https://preview.cardanoscan.io/transaction/97f7aba1fbde7188ecc74cf5415aec4f3d11be813c2f9b0c50dda967b866b14c))
   but the run was aborted because `lucid.awaitTx` failed on a Koios
   response-schema mismatch even though the tx was in a block. Fix: raw
   `/tx_info` confirmation polling (`txOnChain` in `src/common.ts`). The
   vault (100.000102 tADA) remains locked; it could still be redeemed with
   the member key.
2. **Aborted run 2** — CD `TESTNET-20260714-0057-001` completed fully (mint
   [`e8a702b04fcf62ce3403076c5a7d3e6c401762c31d046bae6b1f9702dabb6c97`](https://preview.cardanoscan.io/transaction/e8a702b04fcf62ce3403076c5a7d3e6c401762c31d046bae6b1f9702dabb6c97),
   redeem
   [`7ffc758871dbb518709fdb0fa041d84fc42205b4ee26af23b2655e1ae0c93135`](https://preview.cardanoscan.io/transaction/7ffc758871dbb518709fdb0fa041d84fc42205b4ee26af23b2655e1ae0c93135),
   observed member delta exactly payout − fee). Its sibling CD
   `TESTNET-20260714-0057-002` was minted
   ([`d2a5260771d7c14c41c15eae4bb25c8cae0ababb97d205728f40245bed0edada`](https://preview.cardanoscan.io/transaction/d2a5260771d7c14c41c15eae4bb25c8cae0ababb97d205728f40245bed0edada))
   but its early-withdraw tx was rejected with
   `OutsideValidityIntervalUTxO`: the mempool validates the lower validity
   bound against the node's ledger-tip slot, which trails wall-clock time by
   up to a preview block gap. Fixes: the withdrawal bound is back-dated by
   2 minutes and `submitAndConfirm` now alternates re-submission with
   confirmation checks until the tip catches up. That vault (104.5 tADA)
   also remains locked and redeemable with the member key.

One design note: `@cdt/txlib`'s `buildMintTx` pays the minted CDT to the
owner, but the on-chain `cdt_mint` policy requires the token inside the
vault output; the mint tx is therefore built directly in
`src/lifecycle.ts` (the txlib redeem / early-withdraw builders match the
on-chain vault validator and are reused as-is).

## How to verify

Open any transaction link above on preview.cardanoscan.io, or query Koios:

```sh
curl -s https://preview.koios.rest/api/v1/tx_info -H 'content-type: application/json' \
  -d '{"_tx_hashes":["bd0e93a61bb5734915362dc6c0b51170a66b146f79055b23ddbaf1cda8b81c52"]}'
```

Rerun instructions: see [README.md](./README.md).
