/**
 * Regression tests against the REAL CIP-57 blueprint (`onchain/plutus.json`,
 * produced by `aiken build`), not the always-true fixtures: the emulator
 * phase-2-evaluates the actual `cdt_mint` policy and `cd_vault` validator,
 * so a transaction of the wrong shape fails here exactly as it would
 * on-chain.
 *
 * In particular this pins the mint tx shape the real policy demands: the
 * minted CDT must be locked INSIDE the vault output, together with
 * `>= principal + full_interest` lovelace and the inline `CDDatum` (with
 * `cdt_policy` = the applied policy id). An earlier `buildMintTx` paid the
 * CDT to the owner instead — that shape fails phase-2 validation against
 * the real policy (see the "pre-fix shape" test below), a bug the
 * always-true fixtures could not catch.
 *
 * The blueprint is loaded by relative path from the repo in this test only;
 * the library itself stays blueprint-agnostic.
 */
import { readFileSync } from "node:fs";
import { Data, paymentCredentialOf, toUnit } from "@lucid-evolution/lucid";
import { beforeEach, describe, expect, it } from "vitest";
import {
  resolveCdtScripts,
  type Blueprint,
  type CdtScripts,
} from "../src/blueprint.js";
import {
  buildEarlyWithdrawTx,
  buildMintTx,
  buildRedeemTx,
  type MintTxResult,
} from "../src/builders.js";
import { fullInterest } from "../src/interest.js";
import { CDDatum, MintRedeemer, VaultRedeemer } from "../src/types.js";
import {
  TERM_MS,
  holdsUnit,
  lovelaceAt,
  mintAndSubmit as mintAndSubmitWith,
  setup,
  type Ctx,
} from "./fixtures/harness.js";

// The real blueprint, straight out of `aiken build` (../../onchain from the
// package root). Loaded here only — see module docs.
const blueprint = JSON.parse(
  readFileSync(new URL("../../../onchain/plutus.json", import.meta.url), "utf8"),
) as Blueprint;

const mintAndSubmit = (ctx: Ctx) => mintAndSubmitWith(blueprint, ctx);

/** The oracle-attested datum for the harness terms, as buildMintTx builds it. */
function attestedDatum(ctx: Ctx, scripts: CdtScripts): CDDatum {
  return {
    owner: paymentCredentialOf(ctx.member.address).hash,
    issuer: ctx.terms.issuer,
    deposit_id: ctx.terms.depositId,
    principal: ctx.terms.principal,
    rate_bps: ctx.terms.rateBps,
    start: ctx.terms.start,
    maturity: ctx.terms.maturity,
    penalty_bps: ctx.terms.penaltyBps,
    cdt_policy: scripts.policyId,
    account_id: ctx.terms.accountId,
    attestation_hash: ctx.terms.attestationHash,
  };
}

/** principal + full interest for the harness terms. */
function lockedFor(ctx: Ctx): bigint {
  return (
    ctx.terms.principal +
    fullInterest(
      ctx.terms.principal,
      ctx.terms.rateBps,
      ctx.terms.start,
      ctx.terms.maturity,
    )
  );
}

/**
 * Phase-2 script failures in Lucid Evolution surface as
 * `failed script execution Mint[i]/Spend[i] ...`; match on that wording —
 * including which script purpose failed — so an unrelated builder error
 * (coin selection, min-ADA, ...) cannot masquerade as the on-chain
 * rejection the negative tests mean to prove.
 */
const MINT_PHASE2_FAILURE = /failed script execution Mint/;
const SPEND_PHASE2_FAILURE = /failed script execution Spend/;

describe("buildMintTx against the real blueprint", () => {
  let ctx: Ctx;
  let scripts: CdtScripts;
  beforeEach(async () => {
    ctx = await setup();
    scripts = resolveCdtScripts(ctx.lucid, {
      blueprint,
      oracleVkh: ctx.oracleVkh,
    });
  });

  it("passes phase-2: the CDT is locked in the vault with the funds and datum", async () => {
    const result = await mintAndSubmit(ctx);

    expect(result.lockedLovelace).toBe(lockedFor(ctx));

    // The vault output at the real vault script address holds exactly the
    // shape the policy verified: 1 CDT + principal + full interest + the
    // inline CDDatum with cdt_policy pinned to the applied policy id.
    const utxos = await ctx.lucid.utxosAt(result.scripts.vaultAddress);
    expect(utxos).toHaveLength(1);
    const vaultUtxo = utxos[0]!;
    expect(vaultUtxo.assets[result.unit]).toBe(1n);
    expect(vaultUtxo.assets["lovelace"]).toBe(result.lockedLovelace);
    const datum = Data.from(vaultUtxo.datum!, CDDatum);
    expect(datum).toEqual(result.datum);
    expect(datum).toEqual(attestedDatum(ctx, result.scripts));

    // The owner does NOT hold the token; the datum's `owner` tracks it.
    expect(await holdsUnit(ctx, ctx.member.address, result.unit)).toBe(false);
  });

  it("the pre-fix shape — CDT paid to the owner, not the vault — fails phase-2", async () => {
    // Hand-roll the transaction shape buildMintTx used to produce before the
    // fix: vault output without the token, CDT paid to the owner. The real
    // cdt_mint policy must reject it during script evaluation.
    const datum = attestedDatum(ctx, scripts);
    const unit = toUnit(scripts.policyId, ctx.terms.depositId);

    await expect(
      ctx.lucid
        .newTx()
        .mintAssets({ [unit]: 1n }, Data.to({ MintCD: { datum } }, MintRedeemer))
        .attach.MintingPolicy(scripts.mintPolicy)
        .pay.ToContract(
          scripts.vaultAddress,
          { kind: "inline", value: Data.to(datum, CDDatum) },
          { lovelace: lockedFor(ctx) },
        )
        .pay.ToAddress(ctx.member.address, { [unit]: 1n })
        .addSignerKey(scripts.oracleVkh)
        .complete(),
    ).rejects.toThrow(MINT_PHASE2_FAILURE);
  });

  it("a mint without the oracle's attestation fails phase-2", async () => {
    // Correct vault shape but no oracle extra-signatory: the real policy
    // must reject it.
    const datum = attestedDatum(ctx, scripts);
    const unit = toUnit(scripts.policyId, ctx.terms.depositId);

    await expect(
      ctx.lucid
        .newTx()
        .mintAssets({ [unit]: 1n }, Data.to({ MintCD: { datum } }, MintRedeemer))
        .attach.MintingPolicy(scripts.mintPolicy)
        .pay.ToContract(
          scripts.vaultAddress,
          { kind: "inline", value: Data.to(datum, CDDatum) },
          { lovelace: lockedFor(ctx), [unit]: 1n },
        )
        .complete(),
    ).rejects.toThrow(MINT_PHASE2_FAILURE);
  });
});

describe("full lifecycle against the real blueprint", () => {
  let ctx: Ctx;
  let minted: MintTxResult;
  beforeEach(async () => {
    ctx = await setup();
    minted = await mintAndSubmit(ctx);
  });

  it("mint -> redeem at maturity: burns the CDT and pays principal + full interest", async () => {
    ctx.emulator.awaitSlot(Number(TERM_MS / 1000n) + 10);

    const memberBefore = await lovelaceAt(ctx, ctx.member.address);
    const [vaultUtxo] = await ctx.lucid.utxosAt(minted.scripts.vaultAddress);
    const result = await buildRedeemTx(ctx.lucid, {
      blueprint,
      oracleVkh: ctx.oracleVkh,
      scripts: minted.scripts,
      vaultUtxo: vaultUtxo!,
      ownerAddress: ctx.member.address,
    });
    expect(result.payout).toBe(minted.lockedLovelace);

    const signed = await result.tx.sign.withWallet().complete();
    const fee = signed.toTransaction().body().fee();
    await signed.submit();
    ctx.emulator.awaitBlock(1);

    // Vault empty, CDT burned everywhere, owner received exactly the payout
    // (minus the fee their wallet paid).
    expect(await ctx.lucid.utxosAt(minted.scripts.vaultAddress)).toHaveLength(0);
    expect(await holdsUnit(ctx, ctx.member.address, minted.unit)).toBe(false);
    const memberAfter = await lovelaceAt(ctx, ctx.member.address);
    expect(memberAfter - memberBefore).toBe(result.payout - fee);
  });

  it("mint -> early withdraw: burns the CDT, pays the penalized payout and the issuer remainder", async () => {
    ctx.emulator.awaitSlot(60);
    const t = BigInt(ctx.emulator.now());
    const issuerBefore = await lovelaceAt(ctx, ctx.issuer.address);

    const [vaultUtxo] = await ctx.lucid.utxosAt(minted.scripts.vaultAddress);
    const result = await buildEarlyWithdrawTx(ctx.lucid, {
      blueprint,
      oracleVkh: ctx.oracleVkh,
      scripts: minted.scripts,
      vaultUtxo: vaultUtxo!,
      ownerAddress: ctx.member.address,
      issuerAddress: ctx.issuer.address,
      withdrawAt: t,
    });
    expect(result.payout).toBe(
      minted.datum.principal + result.accrued - result.penalty,
    );
    expect(result.remainder).toBe(minted.lockedLovelace - result.payout);
    expect(result.remainder).toBeGreaterThan(0n);

    const signed = await result.tx.sign.withWallet().complete();
    await signed.submit();
    ctx.emulator.awaitBlock(1);

    expect(await ctx.lucid.utxosAt(minted.scripts.vaultAddress)).toHaveLength(0);
    expect(await holdsUnit(ctx, ctx.member.address, minted.unit)).toBe(false);
    const issuerAfter = await lovelaceAt(ctx, ctx.issuer.address);
    expect(issuerAfter - issuerBefore).toBe(result.remainder);
  });

  it("a redeem whose lower bound is before maturity fails phase-2 against the real vault", async () => {
    // buildRedeemTx refuses validFrom < maturity off-chain, so hand-roll the
    // vault spend with a mid-term lower bound to prove the on-chain check
    // also rejects it (the cd_vault Redeem path requires t >= maturity).
    ctx.emulator.awaitSlot(60);
    const now = BigInt(ctx.emulator.now()); // mid-term, slot-aligned
    expect(now).toBeLessThan(minted.datum.maturity);

    const [vaultUtxo] = await ctx.lucid.utxosAt(minted.scripts.vaultAddress);
    await expect(
      ctx.lucid
        .newTx()
        .collectFrom([vaultUtxo!], Data.to("Redeem", VaultRedeemer))
        .attach.SpendingValidator(minted.scripts.vaultValidator)
        .mintAssets({ [minted.unit]: -1n }, Data.to("BurnCD", MintRedeemer))
        .attach.MintingPolicy(minted.scripts.mintPolicy)
        .validFrom(Number(now))
        .pay.ToAddress(ctx.member.address, { lovelace: minted.lockedLovelace })
        .addSignerKey(minted.datum.owner)
        .complete(),
    ).rejects.toThrow(SPEND_PHASE2_FAILURE);
  });
});
