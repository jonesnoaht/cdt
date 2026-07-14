/**
 * Emulator smoke tests: prove the builders produce submittable transactions
 * against Lucid Evolution's in-process Emulator, using vendored
 * always-succeeds V3 scripts (see fixtures/alwaysTrue.ts) so this package
 * stays independent of the on-chain (Aiken) unit.
 *
 * The always-succeeds scripts cannot enforce the on-chain rules, so
 * validation-side behavior (required signers, validity bounds, amounts) is
 * additionally asserted by inspecting the built transactions.
 */
import {
  Data,
  fromText,
  paymentCredentialOf,
  unixTimeToSlot,
  type UTxO,
} from "@lucid-evolution/lucid";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildEarlyWithdrawTx,
  buildMintTx,
  buildRedeemTx,
  readVaultDatum,
  type MintTxResult,
} from "../src/builders.js";
import { accrued, fullInterest } from "../src/interest.js";
import { CDDatum } from "../src/types.js";
import { fixtureBlueprint } from "./fixtures/alwaysTrue.js";
import {
  TERM_MS,
  holdsUnit,
  lovelaceAt,
  mintAndSubmit as mintAndSubmitWith,
  requiredSigners,
  setup,
  vaultUtxoOf,
  type Ctx,
} from "./fixtures/harness.js";

const blueprint = fixtureBlueprint();

const mintAndSubmit = (ctx: Ctx) => mintAndSubmitWith(blueprint, ctx);

describe("buildMintTx", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await setup();
  });

  it("builds a submittable oracle-co-signed mint tx that locks the CDT + principal + full interest in the vault", async () => {
    const result = await buildMintTx(ctx.lucid, {
      blueprint,
      oracleVkh: ctx.oracleVkh,
      ownerAddress: ctx.member.address,
      terms: ctx.terms,
    });

    // Inspect the built tx: oracle is a required extra signatory, and
    // exactly one CDT (asset name = deposit id) is minted.
    expect(requiredSigners(result.tx)).toContain(ctx.oracleVkh);
    expect(result.unit).toBe(result.scripts.policyId + ctx.terms.depositId);
    expect(result.lockedLovelace).toBe(
      ctx.terms.principal +
        fullInterest(
          ctx.terms.principal,
          ctx.terms.rateBps,
          ctx.terms.start,
          ctx.terms.maturity,
        ),
    );
    expect(result.datum.owner).toBe(
      paymentCredentialOf(ctx.member.address).hash,
    );
    expect(result.datum.cdt_policy).toBe(result.scripts.policyId);

    // Without the oracle witness the emulator must reject the tx.
    const memberOnly = await result.tx.partialSign.withWallet();
    const partiallySigned = await result.tx.assemble([memberOnly]).complete();
    await expect(partiallySigned.submit()).rejects.toThrow();

    // With both witnesses it submits and lands on-chain.
    const oracleWitness = await result.tx.partialSign.withPrivateKey(
      ctx.oracle.privateKey,
    );
    const signed = await result.tx
      .assemble([memberOnly, oracleWitness])
      .complete();
    await signed.submit();
    ctx.emulator.awaitBlock(1);

    // Vault holds the CDT + principal + full interest with the inline
    // CDDatum (the real cdt_mint policy requires the token INSIDE the vault
    // output).
    const vaultUtxo = await vaultUtxoOf(ctx, result);
    expect(vaultUtxo.assets["lovelace"]).toBe(result.lockedLovelace);
    expect(vaultUtxo.assets[result.unit]).toBe(1n);
    expect(vaultUtxo.datum).toBeDefined();
    expect(Data.from(vaultUtxo.datum!, CDDatum)).toEqual(result.datum);

    // The CDT is locked in the vault, NOT paid to the member; ownership is
    // tracked by the datum's `owner` field.
    expect(await holdsUnit(ctx, ctx.member.address, result.unit)).toBe(false);
  });

  it("reuses pre-resolved scripts when given", async () => {
    const first = await buildMintTx(ctx.lucid, {
      blueprint,
      oracleVkh: ctx.oracleVkh,
      ownerAddress: ctx.member.address,
      terms: ctx.terms,
    });
    const second = await buildMintTx(ctx.lucid, {
      blueprint,
      oracleVkh: ctx.oracleVkh,
      scripts: first.scripts,
      ownerAddress: ctx.member.address,
      terms: { ...ctx.terms, depositId: fromText("cd-deposit-0002") },
    });
    expect(second.scripts).toBe(first.scripts);
    expect(second.datum.cdt_policy).toBe(first.datum.cdt_policy);
  });

  it("rejects invalid terms", async () => {
    const base = {
      blueprint,
      oracleVkh: ctx.oracleVkh,
      ownerAddress: ctx.member.address,
    };
    await expect(
      buildMintTx(ctx.lucid, {
        ...base,
        terms: { ...ctx.terms, depositId: "not hex" },
      }),
    ).rejects.toThrow(/hex/);
    await expect(
      buildMintTx(ctx.lucid, {
        ...base,
        terms: { ...ctx.terms, depositId: "00".repeat(33) },
      }),
    ).rejects.toThrow(/1\.\.32 bytes/);
    await expect(
      buildMintTx(ctx.lucid, {
        ...base,
        terms: { ...ctx.terms, issuer: "" },
      }),
    ).rejects.toThrow(/issuer/);
    await expect(
      buildMintTx(ctx.lucid, {
        ...base,
        terms: { ...ctx.terms, principal: 0n },
      }),
    ).rejects.toThrow(/positive/);
    await expect(
      buildMintTx(ctx.lucid, {
        ...base,
        terms: { ...ctx.terms, maturity: ctx.terms.start },
      }),
    ).rejects.toThrow(/maturity/);
    await expect(
      buildMintTx(ctx.lucid, {
        ...base,
        terms: { ...ctx.terms, penaltyBps: 10_001n },
      }),
    ).rejects.toThrow(/penalty_bps/);
    await expect(
      buildMintTx(ctx.lucid, { ...base, oracleVkh: "abcd", terms: ctx.terms }),
    ).rejects.toThrow(/28 bytes/);
  });

  it("rejects a tiny CD whose vault output would be below min-ADA", async () => {
    await expect(
      buildMintTx(ctx.lucid, {
        blueprint,
        oracleVkh: ctx.oracleVkh,
        ownerAddress: ctx.member.address,
        terms: { ...ctx.terms, principal: 100_000n },
      }),
    ).rejects.toThrow(/min-ADA/);
  });
});

describe("buildRedeemTx", () => {
  let ctx: Ctx;
  let minted: MintTxResult;
  beforeEach(async () => {
    ctx = await setup();
    minted = await mintAndSubmit(ctx);
  });

  it("redeems principal + full interest at maturity and burns the CDT", async () => {
    // Advance the chain past maturity.
    ctx.emulator.awaitSlot(Number(TERM_MS / 1000n) + 10);

    const vaultUtxo = await vaultUtxoOf(ctx, minted);
    const result = await buildRedeemTx(ctx.lucid, {
      blueprint,
      oracleVkh: ctx.oracleVkh,
      vaultUtxo,
      ownerAddress: ctx.member.address,
    });

    expect(result.payout).toBe(minted.lockedLovelace);
    expect(result.unit).toBe(minted.unit);
    expect(result.validFrom).toBeGreaterThanOrEqual(result.datum.maturity);

    // The validity lower bound is the slot whose begin time is the aligned
    // bound, and the owner is a required signer.
    const body = result.tx.toTransaction().body();
    expect(body.validity_interval_start()).toBe(
      BigInt(unixTimeToSlot("Custom", Number(result.validFrom))),
    );
    expect(requiredSigners(result.tx)).toContain(result.datum.owner);

    const signed = await result.tx.sign.withWallet().complete();
    await signed.submit();
    ctx.emulator.awaitBlock(1);

    // Vault is empty and the CDT is burned.
    expect(await ctx.lucid.utxosAt(minted.scripts.vaultAddress)).toHaveLength(0);
    expect(await holdsUnit(ctx, ctx.member.address, minted.unit)).toBe(false);
  });

  it("aligns a non-slot-aligned maturity UP so the bound is never before maturity", async () => {
    // Fresh emulator whose CD matures 500 ms past a slot boundary.
    const ctx2 = await setup();
    const ctx3: Ctx = {
      ...ctx2,
      terms: { ...ctx2.terms, maturity: ctx2.terms.maturity + 500n },
    };
    const minted2 = await mintAndSubmit(ctx3);
    ctx3.emulator.awaitSlot(Number(TERM_MS / 1000n) + 10);

    const vaultUtxo = await vaultUtxoOf(ctx3, minted2);
    const result = await buildRedeemTx(ctx3.lucid, {
      blueprint,
      oracleVkh: ctx3.oracleVkh,
      vaultUtxo,
      ownerAddress: ctx3.member.address,
    });

    // The aligned bound is the NEXT slot boundary after maturity, never
    // floored below it.
    expect(result.validFrom).toBe(result.datum.maturity + 500n);
    const boundSlot = result.tx
      .toTransaction()
      .body()
      .validity_interval_start()!;
    expect(BigInt(unixTimeToSlot("Custom", Number(result.validFrom)))).toBe(
      boundSlot,
    );

    const signed = await result.tx.sign.withWallet().complete();
    await signed.submit();
    ctx3.emulator.awaitBlock(1);
    expect(await ctx3.lucid.utxosAt(minted2.scripts.vaultAddress)).toHaveLength(0);
  });

  it("refuses a lower bound before maturity", async () => {
    ctx.emulator.awaitSlot(Number(TERM_MS / 1000n) + 10);
    const vaultUtxo = await vaultUtxoOf(ctx, minted);
    await expect(
      buildRedeemTx(ctx.lucid, {
        blueprint,
        oracleVkh: ctx.oracleVkh,
        vaultUtxo,
        ownerAddress: ctx.member.address,
        validFrom: minted.datum.maturity - 1n,
      }),
    ).rejects.toThrow(/validFrom/);
  });

  it("refuses an ownerAddress whose credential is not the datum owner", async () => {
    ctx.emulator.awaitSlot(Number(TERM_MS / 1000n) + 10);
    const vaultUtxo = await vaultUtxoOf(ctx, minted);
    await expect(
      buildRedeemTx(ctx.lucid, {
        blueprint,
        oracleVkh: ctx.oracleVkh,
        vaultUtxo,
        ownerAddress: ctx.issuer.address,
      }),
    ).rejects.toThrow(/does not match the datum's owner/);
  });

  it("refuses a vault datum minted under a different policy", async () => {
    ctx.emulator.awaitSlot(Number(TERM_MS / 1000n) + 10);
    const vaultUtxo = await vaultUtxoOf(ctx, minted);
    await expect(
      buildRedeemTx(ctx.lucid, {
        blueprint,
        // Different oracle parameter -> different policy id than the datum's.
        oracleVkh: "00".repeat(28),
        vaultUtxo,
        ownerAddress: ctx.member.address,
      }),
    ).rejects.toThrow(/cdt_policy/);
  });

  it("refuses a vault UTxO that does not hold the CDT", async () => {
    ctx.emulator.awaitSlot(Number(TERM_MS / 1000n) + 10);
    const vaultUtxo = await vaultUtxoOf(ctx, minted);
    const stripped: UTxO = {
      ...vaultUtxo,
      assets: { lovelace: vaultUtxo.assets["lovelace"]! },
    };
    await expect(
      buildRedeemTx(ctx.lucid, {
        blueprint,
        oracleVkh: ctx.oracleVkh,
        vaultUtxo: stripped,
        ownerAddress: ctx.member.address,
      }),
    ).rejects.toThrow(/expected exactly 1/);
  });

  it("readVaultDatum rejects out-of-range on-chain datums", () => {
    const hostile: CDDatum = { ...minted.datum, penalty_bps: 20_001n };
    const fakeUtxo: UTxO = {
      txHash: "00".repeat(32),
      outputIndex: 0,
      address: minted.scripts.vaultAddress,
      assets: { lovelace: 5_000_000n },
      datum: Data.to(hostile, CDDatum),
    };
    expect(() => readVaultDatum(fakeUtxo, minted.scripts)).toThrow(
      /penalty_bps/,
    );
  });
});

describe("buildEarlyWithdrawTx", () => {
  let ctx: Ctx;
  let minted: MintTxResult;
  beforeEach(async () => {
    ctx = await setup();
    minted = await mintAndSubmit(ctx);
  });

  it("pays the owner the penalized payout and returns the remainder to the issuer", async () => {
    // Advance to mid-term.
    ctx.emulator.awaitSlot(60);
    const t = BigInt(ctx.emulator.now());
    expect(t).toBeGreaterThanOrEqual(minted.datum.start);
    expect(t).toBeLessThan(minted.datum.maturity);

    const issuerBalanceBefore = await lovelaceAt(ctx, ctx.issuer.address);

    const vaultUtxo = await vaultUtxoOf(ctx, minted);
    const result = await buildEarlyWithdrawTx(ctx.lucid, {
      blueprint,
      oracleVkh: ctx.oracleVkh,
      vaultUtxo,
      ownerAddress: ctx.member.address,
      issuerAddress: ctx.issuer.address,
      withdrawAt: t,
    });

    // Off-chain math mirror is respected by the built amounts, all computed
    // at the effective (slot-aligned) withdrawal time.
    expect(result.validFrom).toBe(t); // t is already slot-aligned here
    expect(result.accrued).toBe(
      accrued(
        minted.datum.principal,
        minted.datum.rate_bps,
        minted.datum.start,
        minted.datum.maturity,
        result.validFrom,
      ),
    );
    expect(result.payout).toBe(
      minted.datum.principal + result.accrued - result.penalty,
    );
    expect(result.remainder).toBe(minted.lockedLovelace - result.payout);
    expect(result.remainder).toBeGreaterThan(0n);

    // Lower bound is the slot enclosing the aligned time, and the owner is
    // a required signer.
    const body = result.tx.toTransaction().body();
    expect(body.validity_interval_start()).toBe(
      BigInt(unixTimeToSlot("Custom", Number(result.validFrom))),
    );
    expect(requiredSigners(result.tx)).toContain(minted.datum.owner);

    const signed = await result.tx.sign.withWallet().complete();
    await signed.submit();
    ctx.emulator.awaitBlock(1);

    // Vault is empty, CDT burned, issuer received exactly the remainder.
    expect(await ctx.lucid.utxosAt(minted.scripts.vaultAddress)).toHaveLength(0);
    expect(await holdsUnit(ctx, ctx.member.address, minted.unit)).toBe(false);
    const issuerBalanceAfter = await lovelaceAt(ctx, ctx.issuer.address);
    expect(issuerBalanceAfter - issuerBalanceBefore).toBe(result.remainder);
  });

  it("aligns a non-slot-aligned withdrawal time UP and computes amounts at the bound", async () => {
    ctx.emulator.awaitSlot(60);
    const t = BigInt(ctx.emulator.now()) + 500n; // mid-slot

    const vaultUtxo = await vaultUtxoOf(ctx, minted);
    const result = await buildEarlyWithdrawTx(ctx.lucid, {
      blueprint,
      oracleVkh: ctx.oracleVkh,
      vaultUtxo,
      ownerAddress: ctx.member.address,
      issuerAddress: ctx.issuer.address,
      withdrawAt: t,
    });

    // Effective time is the NEXT slot boundary, and the math uses it.
    expect(result.validFrom).toBe(t + 500n);
    expect(result.accrued).toBe(
      accrued(
        minted.datum.principal,
        minted.datum.rate_bps,
        minted.datum.start,
        minted.datum.maturity,
        result.validFrom,
      ),
    );
    expect(result.payout).toBe(
      minted.datum.principal + result.accrued - result.penalty,
    );

    // The bound is one slot in the future; advance one slot, then submit.
    ctx.emulator.awaitSlot(1);
    const signed = await result.tx.sign.withWallet().complete();
    await signed.submit();
    ctx.emulator.awaitBlock(1);
    expect(await ctx.lucid.utxosAt(minted.scripts.vaultAddress)).toHaveLength(0);
  });

  it("refuses withdrawal outside [start, maturity)", async () => {
    ctx.emulator.awaitSlot(60);
    const vaultUtxo = await vaultUtxoOf(ctx, minted);
    const base = {
      blueprint,
      oracleVkh: ctx.oracleVkh,
      vaultUtxo,
      ownerAddress: ctx.member.address,
      issuerAddress: ctx.issuer.address,
    };
    await expect(
      buildEarlyWithdrawTx(ctx.lucid, {
        ...base,
        withdrawAt: minted.datum.maturity,
      }),
    ).rejects.toThrow(/withdrawAt/);
    await expect(
      buildEarlyWithdrawTx(ctx.lucid, {
        ...base,
        withdrawAt: minted.datum.start - 1n,
      }),
    ).rejects.toThrow(/withdrawAt/);
    // In [start, maturity) but aligning up crosses maturity.
    await expect(
      buildEarlyWithdrawTx(ctx.lucid, {
        ...base,
        withdrawAt: minted.datum.maturity - 1n,
      }),
    ).rejects.toThrow(/buildRedeemTx/);
  });

  it("refuses an ownerAddress whose credential is not the datum owner", async () => {
    ctx.emulator.awaitSlot(60);
    const vaultUtxo = await vaultUtxoOf(ctx, minted);
    await expect(
      buildEarlyWithdrawTx(ctx.lucid, {
        blueprint,
        oracleVkh: ctx.oracleVkh,
        vaultUtxo,
        ownerAddress: ctx.issuer.address,
        issuerAddress: ctx.issuer.address,
        withdrawAt: BigInt(ctx.emulator.now()),
      }),
    ).rejects.toThrow(/does not match the datum's owner/);
  });

  it("refuses an issuerAddress whose credential is not the datum issuer", async () => {
    ctx.emulator.awaitSlot(60);
    const vaultUtxo = await vaultUtxoOf(ctx, minted);
    await expect(
      buildEarlyWithdrawTx(ctx.lucid, {
        blueprint,
        oracleVkh: ctx.oracleVkh,
        vaultUtxo,
        ownerAddress: ctx.member.address,
        issuerAddress: ctx.member.address,
        withdrawAt: BigInt(ctx.emulator.now()),
      }),
    ).rejects.toThrow(/does not match the datum's issuer/);
  });
});
