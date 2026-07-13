/**
 * End-to-end lifecycle tests on the in-process Lucid emulator.
 *
 * Balance assertions are exact to the lovelace. Where tx fees would muddy a
 * raw wallet delta, we assert on the vault/mint amounts and on dedicated
 * payout outputs instead, and account for the fee explicitly.
 */

import { describe, expect, it } from "vitest";
import { Data } from "@lucid-evolution/lucid";

import { CDDatum, MintRedeemer, VaultRedeemer } from "../src/contracts.js";
import {
  accrued,
  BPS_DENOMINATOR,
  earlyPayout,
  fullInterest,
  maturePayout,
  penaltyFee,
  YEAR_MS,
} from "../src/interest.js";
import {
  advancePast,
  circulatingSupply,
  depositIdToAssetName,
  earlyWithdrawCd,
  findVaultUtxo,
  lovelaceAt,
  mintCd,
  redeemCd,
  setupChain,
  type ChainContext,
  type CdOnChain,
} from "../src/lifecycle.js";

const PRINCIPAL = 10_000_000_000n; // 10,000 ADA ≙ $10,000
const RATE_BPS = 450n;
const TERM_MS = 120_000n;
const PENALTY_BPS = 1_000n;

const DEPOSIT_ID = depositIdToAssetName("CDT-test-001");

async function mintStandardCd(
  ctx: ChainContext,
  depositIdHex = DEPOSIT_ID,
): Promise<CdOnChain> {
  return mintCd(ctx, depositIdHex, {
    principal: PRINCIPAL,
    rateBps: RATE_BPS,
    termMs: TERM_MS,
    penaltyBps: PENALTY_BPS,
  });
}

describe("CDT lifecycle (emulator e2e)", () => {
  it("mints, matures, and redeems for exactly principal + full interest", async () => {
    const ctx = await setupChain();
    const cd = await mintStandardCd(ctx);

    // Vault holds exactly principal + full interest and exactly one CDT,
    // under the inline datum the policy attested to.
    const vaultUtxo = await findVaultUtxo(ctx, cd.unit);
    const expectedInterest =
      (PRINCIPAL * RATE_BPS * TERM_MS) / (BPS_DENOMINATOR * YEAR_MS);
    expect(fullInterest(cd.terms)).toBe(expectedInterest);
    expect(vaultUtxo.assets.lovelace).toBe(PRINCIPAL + expectedInterest);
    expect(vaultUtxo.assets[cd.unit]).toBe(1n);
    expect(Data.from(vaultUtxo.datum!, CDDatum)).toEqual(cd.datum);
    expect(circulatingSupply(ctx, cd.unit)).toBe(1n);

    // Past maturity, the member redeems.
    advancePast(ctx, cd.terms.maturity);
    const memberBefore = await lovelaceAt(ctx, ctx.member.account.address);
    const redemption = await redeemCd(ctx, cd);
    const memberAfter = await lovelaceAt(ctx, ctx.member.account.address);

    // Exact payout, exact wallet delta (vault release minus the tx fee),
    // token burned, vault emptied.
    expect(redemption.payout).toBe(maturePayout(cd.terms));
    expect(redemption.payout).toBe(PRINCIPAL + expectedInterest);
    expect(memberAfter - memberBefore).toBe(cd.locked - redemption.fee);
    const memberUtxos = await ctx.lucid.utxosAt(ctx.member.account.address);
    expect(
      memberUtxos.some((utxo) => utxo.assets.lovelace === redemption.payout),
    ).toBe(true);
    expect(circulatingSupply(ctx, cd.unit)).toBe(0n);
    await expect(
      ctx.lucid.utxosAtWithUnit(ctx.contracts.vaultAddress, cd.unit),
    ).resolves.toHaveLength(0);
  });

  it("early withdrawal pays principal + accrued - penalty and returns the remainder to the issuer", async () => {
    const ctx = await setupChain();
    const cd = await mintStandardCd(ctx);

    // Move to roughly mid-term.
    advancePast(ctx, cd.terms.start + 60_000n);
    const t = BigInt(ctx.emulator.now());
    expect(t).toBeGreaterThanOrEqual(cd.terms.start);
    expect(t).toBeLessThan(cd.terms.maturity);

    const expectedAccrued = accrued(cd.terms, t);
    const expectedFee = penaltyFee(expectedAccrued, PENALTY_BPS);
    const expectedPayout = PRINCIPAL + expectedAccrued - expectedFee;
    expect(earlyPayout(cd.terms, t)).toBe(expectedPayout);

    const memberBefore = await lovelaceAt(ctx, ctx.member.account.address);
    const issuerBefore = await lovelaceAt(ctx, ctx.creditUnion.account.address);
    const withdrawal = await earlyWithdrawCd(ctx, cd);
    const memberAfter = await lovelaceAt(ctx, ctx.member.account.address);
    const issuerAfter = await lovelaceAt(ctx, ctx.creditUnion.account.address);

    expect(withdrawal.at).toBe(t);
    expect(withdrawal.payout).toBe(expectedPayout);
    // The validator demands at least the remainder back to the issuer; we pay
    // it in a dedicated output (topped up to min-ADA).
    expect(withdrawal.remainder).toBe(cd.locked - expectedPayout);
    expect(withdrawal.issuerReturn).toBeGreaterThanOrEqual(withdrawal.remainder);
    expect(issuerAfter - issuerBefore).toBe(withdrawal.issuerReturn);
    // Member nets the vault release minus the issuer's cut minus the tx fee.
    expect(memberAfter - memberBefore).toBe(
      cd.locked - withdrawal.issuerReturn - withdrawal.fee,
    );
    const memberUtxos = await ctx.lucid.utxosAt(ctx.member.account.address);
    expect(
      memberUtxos.some((utxo) => utxo.assets.lovelace === withdrawal.payout),
    ).toBe(true);
    expect(circulatingSupply(ctx, cd.unit)).toBe(0n);
  });

  it("rejects redemption before maturity", async () => {
    const ctx = await setupChain();
    const cd = await mintStandardCd(ctx);

    // Only one block has passed; we are well before maturity.
    expect(BigInt(ctx.emulator.now())).toBeLessThan(cd.terms.maturity);
    await expect(redeemCd(ctx, cd)).rejects.toThrow();

    // The vault is untouched and the CDT still exists.
    const vaultUtxo = await findVaultUtxo(ctx, cd.unit);
    expect(vaultUtxo.assets.lovelace).toBe(cd.locked);
    expect(circulatingSupply(ctx, cd.unit)).toBe(1n);
  });

  it("rejects minting without the oracle's attestation signature", async () => {
    const ctx = await setupChain();

    // Same real mint code path, minus the oracle's required signature.
    await expect(
      mintCd(
        ctx,
        DEPOSIT_ID,
        {
          principal: PRINCIPAL,
          rateBps: RATE_BPS,
          termMs: TERM_MS,
          penaltyBps: PENALTY_BPS,
        },
        { attested: false },
      ),
    ).rejects.toThrow();
    expect(circulatingSupply(ctx, ctx.contracts.policyId + DEPOSIT_ID)).toBe(0n);
  });

  it("rejects spending the vault without burning the CDT", async () => {
    const ctx = await setupChain();
    const cd = await mintStandardCd(ctx);
    advancePast(ctx, cd.terms.maturity);

    const vaultUtxo = await findVaultUtxo(ctx, cd.unit);
    const { lucid, member, contracts } = ctx;
    lucid.selectWallet.fromPrivateKey(member.account.privateKey);
    await expect(
      lucid
        .newTx()
        .collectFrom([vaultUtxo], Data.to("Redeem", VaultRedeemer))
        .attach.SpendingValidator(contracts.vaultScript)
        // token is kept, not burned — the validator must refuse
        .pay.ToAddress(member.account.address, {
          lovelace: maturePayout(cd.terms),
        })
        .addSigner(member.account.address)
        .validFrom(Number(ctx.emulator.now()))
        .complete(),
    ).rejects.toThrow();
  });

  it("rejects batched redemption of two vaults in one tx (double-satisfaction guard)", async () => {
    const ctx = await setupChain();
    const cdA = await mintStandardCd(ctx, depositIdToAssetName("CDT-test-A"));
    const cdB = await mintStandardCd(ctx, depositIdToAssetName("CDT-test-B"));
    advancePast(ctx, cdB.terms.maturity);

    const vaultA = await findVaultUtxo(ctx, cdA.unit);
    const vaultB = await findVaultUtxo(ctx, cdB.unit);
    const { lucid, member, contracts } = ctx;
    lucid.selectWallet.fromPrivateKey(member.account.privateKey);

    // Everything about this tx is individually honest (both burns, both
    // payouts), but the vault validator forbids spending two vault UTxOs in
    // one transaction to rule out double-satisfaction of its output checks
    // (e.g. one issuer output "paying" several early-withdrawal remainders).
    await expect(
      lucid
        .newTx()
        .collectFrom([vaultA, vaultB], Data.to("Redeem", VaultRedeemer))
        .attach.SpendingValidator(contracts.vaultScript)
        .mintAssets(
          { [cdA.unit]: -1n, [cdB.unit]: -1n },
          Data.to("BurnCD", MintRedeemer),
        )
        .attach.MintingPolicy(contracts.mintScript)
        .pay.ToAddress(member.account.address, {
          lovelace: maturePayout(cdA.terms) + maturePayout(cdB.terms),
        })
        .addSigner(member.account.address)
        .validFrom(Number(ctx.emulator.now()))
        .complete(),
    ).rejects.toThrow();

    // Both vaults remain intact.
    expect(circulatingSupply(ctx, cdA.unit)).toBe(1n);
    expect(circulatingSupply(ctx, cdB.unit)).toBe(1n);
  });
});
