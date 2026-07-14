/**
 * End-to-end pipeline test: dockerized bank Postgres + in-process Lucid
 * Emulator.
 *
 * Happy path: seed member + product -> insert a CD deposit -> one watcher
 * poll cycle -> attestation row + on-chain mint + vault UTxO with the
 * correct inline datum -> advance the emulator past maturity -> redeem via
 * the same code path as the CLI -> exact-lovelace payouts + DB write-backs.
 *
 * Negative paths: an unenrolled member (failed VC verification) never mints;
 * a failing first mint attempt is re-delivered by the watcher's retry queue
 * and lands exactly once (no double-mint of the same deposit_id).
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fromText } from "../src/lucid.js";
import {
  accrued,
  fullInterest,
  penaltyFee,
} from "../../cdt-txlib/src/index.ts";
import type { SignedAttestation } from "../../oracle-watcher/src/index.ts";
import { loadEnv } from "../src/env.js";
import { createChainContext, type ChainContext } from "../src/provider.js";
import { CredentialDirectory } from "../src/credentials.js";
import {
  IssuanceService,
  type MintInterceptor,
} from "../src/service.js";
import {
  quietLog,
  resetSchema,
  seedAccount,
  seedDeposit,
  seedProduct,
  testPool,
} from "./helpers.js";

let pool: pg.Pool;

beforeAll(async () => {
  pool = testPool();
  await pool.query("SELECT 1"); // fail fast if the test DB is not up
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetSchema(pool);
});

async function makeService(opts: { interceptMint?: MintInterceptor } = {}): Promise<{
  chain: ChainContext;
  directory: CredentialDirectory;
  service: IssuanceService;
}> {
  const env = loadEnv({ ...process.env, CDT_NETWORK: "emulator" });
  const chain = await createChainContext(env);
  const directory = new CredentialDirectory();
  const service = new IssuanceService({
    pool,
    chain,
    directory,
    log: quietLog,
    maxMintAttempts: 5,
    interceptMint: opts.interceptMint,
  });
  return { chain, directory, service };
}

async function payloadOf(depositId: string): Promise<Record<string, unknown>> {
  const { rows } = await pool.query(
    "SELECT payload FROM attestations WHERE deposit_id = $1",
    [depositId],
  );
  expect(rows).toHaveLength(1);
  return rows[0].payload as Record<string, unknown>;
}

describe("issuance pipeline (emulator + dockerized bank db)", () => {
  it("mints on attestation, then redeems principal + full interest at maturity", async () => {
    const productId = await seedProduct(pool, {
      termMonths: 6,
      rateBps: 400,
      penaltyBps: 1000,
      minDepositCents: 50_000n,
    });
    const accountId = await seedAccount(pool, {
      memberName: "Ada Lovelace",
      did: "did:demo:ada",
    });
    const { chain, service } = await makeService();
    await service.boot();

    // $1,000.00 -> 1,000 ADA principal at the demo peg (1 cent = 10k lovelace).
    const txId = await seedDeposit(pool, {
      accountId,
      amountCents: 100_000n,
      productId,
    });
    const depositId = String(txId);

    // One watcher poll cycle: verify VC, attest, deliver -> mint.
    const recorded = await service.watcher.pollOnce();
    expect(recorded).toHaveLength(1);
    const attestation = recorded[0]!;
    expect(attestation.payload.deposit_id).toBe(depositId);

    // The member got the (boot-assigned) emulator wallet as owner.
    const member = chain.memberWallets[0]!;
    expect(attestation.payload.owner).toBe(member.address);

    // DB: attestation row exists, deposit flagged attested, tx hash merged
    // into the JSONB payload.
    const payload = await payloadOf(depositId);
    expect(payload.tx_hash).toMatch(/^[0-9a-f]{64}$/);
    const { rows: txRows } = await pool.query(
      "SELECT attested FROM transactions WHERE id = $1",
      [txId],
    );
    expect(txRows[0].attested).toBe(true);

    // Chain: vault UTxO with the correct inline datum, funded with
    // principal + full interest AND custody of the CDT (the on-chain policy
    // requires the token in the vault; the member's claim is datum.owner).
    const found = await service.findVaultUtxo(depositId);
    expect(found).toBeDefined();
    const { unit, utxo, datum } = found!;
    expect(datum.owner).toBe(member.vkh);
    expect(datum.issuer).toBe(chain.issuer.vkh);
    expect(datum.deposit_id).toBe(fromText(depositId));
    expect(datum.principal).toBe(1_000_000_000n);
    expect(datum.rate_bps).toBe(400n);
    expect(datum.penalty_bps).toBe(1000n);
    expect(datum.start).toBe(BigInt(attestation.payload.start));
    expect(datum.maturity).toBe(BigInt(attestation.payload.maturity));
    expect(datum.cdt_policy).toBe(chain.scripts.policyId);
    const interest = fullInterest(
      datum.principal,
      datum.rate_bps,
      datum.start,
      datum.maturity,
    );
    expect(interest).toBeGreaterThan(0n);
    expect(utxo.assets["lovelace"]).toBe(datum.principal + interest);
    expect(utxo.assets[unit]).toBe(1n);

    // Re-delivering the same attestation must NOT mint a second time.
    const again = await service.mintAttested(attestation);
    expect(again.alreadyMinted).toBe(true);
    expect(again.txHash).toBe(payload.tx_hash);
    expect(
      await chain.lucid.utxosAtWithUnit(chain.scripts.vaultAddress, unit),
    ).toHaveLength(1);

    // A second poll cycle finds nothing new.
    expect(await service.watcher.pollOnce()).toHaveLength(0);

    // Advance the emulator past maturity and redeem through the same code
    // path as the CLI.
    const deltaMs = Number(datum.maturity) - chain.now();
    expect(deltaMs).toBeGreaterThan(0);
    chain.emulator!.awaitSlot(Math.ceil(deltaMs / 1000) + 5);

    const outcome = await service.redeem({ depositId });
    expect(outcome.kind).toBe("redeem");
    expect(outcome.principal).toBe(datum.principal);
    expect(outcome.interest).toBe(interest);
    expect(outcome.penalty).toBe(0n);
    expect(outcome.payout).toBe(datum.principal + interest); // exact lovelace

    // Vault emptied, CDT burned, exact payout output at the member.
    expect(await service.findVaultUtxo(depositId)).toBeUndefined();
    const memberAfter = await chain.lucid.utxosAt(member.address);
    expect(memberAfter.some((u) => (u.assets[unit] ?? 0n) > 0n)).toBe(false);
    expect(
      memberAfter.some((u) => u.assets["lovelace"] === outcome.payout),
    ).toBe(true);

    // DB reflects the redemption.
    const after = await payloadOf(depositId);
    expect(after.redeem_tx_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(after.redeem_kind).toBe("redeem");
  });

  it("early-withdraws with penalty, returning the remainder to the issuer", async () => {
    const productId = await seedProduct(pool, {
      termMonths: 12,
      rateBps: 450,
      penaltyBps: 1000,
      minDepositCents: 100_000n,
    });
    const accountId = await seedAccount(pool, {
      memberName: "Grace Hopper",
      did: "did:demo:grace",
    });
    const { chain, service } = await makeService();
    await service.boot();
    const txId = await seedDeposit(pool, {
      accountId,
      amountCents: 250_000n, // $2,500 -> 2,500 ADA
      productId,
    });
    const depositId = String(txId);

    await service.watcher.pollOnce();
    const found = await service.findVaultUtxo(depositId);
    expect(found).toBeDefined();
    const { datum } = found!;
    const locked = found!.utxo.assets["lovelace"]!;

    // Advance to roughly half-term, then early-withdraw.
    const halfTermMs = Number(datum.maturity - datum.start) / 2;
    chain.emulator!.awaitSlot(Math.ceil(halfTermMs / 1000));

    const outcome = await service.redeem({ depositId, early: true });
    expect(outcome.kind).toBe("early_withdraw");
    expect(BigInt(chain.now())).toBeGreaterThanOrEqual(outcome.effectiveAt);

    // Exact math mirror at the effective (slot-aligned) withdrawal time.
    const expectedAccrued = accrued(
      datum.principal,
      datum.rate_bps,
      datum.start,
      datum.maturity,
      outcome.effectiveAt,
    );
    const expectedPenalty = penaltyFee(
      datum.principal,
      datum.rate_bps,
      datum.start,
      datum.maturity,
      datum.penalty_bps,
      outcome.effectiveAt,
    );
    expect(expectedAccrued).toBeGreaterThan(0n);
    expect(expectedPenalty).toBeGreaterThan(0n);
    expect(outcome.interest).toBe(expectedAccrued);
    expect(outcome.penalty).toBe(expectedPenalty);
    expect(outcome.payout).toBe(
      datum.principal + expectedAccrued - expectedPenalty,
    );
    expect(outcome.remainder).toBe(locked - outcome.payout);
    expect(outcome.remainder).toBeGreaterThan(0n);

    // The issuer received exactly the remainder; the member exactly the payout.
    const issuerUtxos = await chain.lucid.utxosAt(chain.issuer.address);
    expect(
      issuerUtxos.some((u) => u.assets["lovelace"] === outcome.remainder),
    ).toBe(true);
    const memberUtxos = await chain.lucid.utxosAt(
      chain.memberWallets[0]!.address,
    );
    expect(
      memberUtxos.some((u) => u.assets["lovelace"] === outcome.payout),
    ).toBe(true);

    expect(await service.findVaultUtxo(depositId)).toBeUndefined();
    const payload = await payloadOf(depositId);
    expect(payload.redeem_kind).toBe("early_withdraw");
  });

  it("does not attest or mint when VC verification fails", async () => {
    const productId = await seedProduct(pool);
    const { chain, service } = await makeService();
    await service.boot(); // ceremony runs BEFORE Mallory opens an account

    const accountId = await seedAccount(pool, {
      memberName: "Mallory",
      did: "did:demo:mallory", // never enrolled -> presentation fails
      walletAddress: chain.memberWallets[0]!.address,
    });
    const txId = await seedDeposit(pool, {
      accountId,
      amountCents: 100_000n,
      productId,
    });

    const recorded = await service.watcher.pollOnce();
    expect(recorded).toHaveLength(0);

    // No attestation, deposit still unattested, nothing on chain.
    const { rows } = await pool.query("SELECT count(*) FROM attestations");
    expect(Number(rows[0].count)).toBe(0);
    const { rows: txRows } = await pool.query(
      "SELECT attested FROM transactions WHERE id = $1",
      [txId],
    );
    expect(txRows[0].attested).toBe(false);
    expect(await chain.lucid.utxosAt(chain.scripts.vaultAddress)).toHaveLength(0);
  });

  it("re-delivers a failed mint through the retry queue and mints exactly once", async () => {
    const productId = await seedProduct(pool);
    const accountId = await seedAccount(pool, {
      memberName: "Satoshi Tanaka",
      did: "did:demo:satoshi",
    });

    let attempts = 0;
    let delivered: SignedAttestation | undefined;
    const interceptMint: MintInterceptor = async (attestation, mint) => {
      attempts += 1;
      delivered = attestation;
      if (attempts === 1) throw new Error("simulated mint outage");
      return mint();
    };
    const { chain, service } = await makeService({ interceptMint });
    await service.boot();
    const txId = await seedDeposit(pool, {
      accountId,
      amountCents: 100_000n,
      productId,
    });
    const depositId = String(txId);
    const unitOf = async (): Promise<string | undefined> =>
      (await service.findVaultUtxo(depositId))?.unit;

    // Cycle 1: attestation is recorded and committed, but delivery fails.
    const recorded = await service.watcher.pollOnce();
    expect(recorded).toHaveLength(1);
    expect(attempts).toBe(1);
    expect(await unitOf()).toBeUndefined();
    expect((await payloadOf(depositId)).tx_hash).toBeUndefined();

    // Cycle 2: the retry queue re-delivers the SAME attestation; the mint lands.
    expect(await service.watcher.pollOnce()).toHaveLength(0); // nothing new attested
    expect(attempts).toBe(2);
    expect(delivered!.payload.deposit_id).toBe(depositId);
    const unit = await unitOf();
    expect(unit).toBeDefined();
    expect((await payloadOf(depositId)).tx_hash).toMatch(/^[0-9a-f]{64}$/);

    // Cycle 3: no further deliveries, and exactly one CDT exists.
    expect(await service.watcher.pollOnce()).toHaveLength(0);
    expect(attempts).toBe(2);
    expect(
      await chain.lucid.utxosAtWithUnit(chain.scripts.vaultAddress, unit!),
    ).toHaveLength(1);

    // Even a manual duplicate delivery cannot double-mint the deposit_id.
    const again = await service.mintAttested(delivered!);
    expect(again.alreadyMinted).toBe(true);
    const vaultUtxos = await chain.lucid.utxosAt(chain.scripts.vaultAddress);
    const totalTokens = vaultUtxos.reduce(
      (sum, u) => sum + (u.assets[unit!] ?? 0n),
      0n,
    );
    expect(totalTokens).toBe(1n);
  });
});
