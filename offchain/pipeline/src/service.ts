/**
 * The CDT issuance service: the glue between the bank's oracle watcher and
 * on-chain minting.
 *
 * Boot ceremony:
 *  1. build the NCUA -> credit-union -> member credential chain for every
 *     member in the bank's accounts table (see credentials.ts);
 *  2. (emulator mode) assign each member a pre-funded emulator wallet and
 *     write its address into `accounts.wallet_address` so attestations carry
 *     a spendable owner address.
 *
 * Runtime: the OracleWatcher polls the bank Postgres for unattested CD
 * deposits, verifies the member's VC presentation through the credential
 * directory, signs an attestation, and delivers it to `onAttested` — which
 * this service wires to an actual mint:
 *
 *   attestation payload -> CDDatum/CDTerms (txlib schemas) -> mint tx (see
 *   mint.ts: the CDT is locked in the vault output, as the real on-chain
 *   policy demands) -> sign with issuer wallet + oracle key -> submit ->
 *   await confirmation -> merge the tx hash into the bank DB's
 *   `attestations.payload` JSONB.
 *
 * Delivery is at-least-once (the watcher re-delivers failed attestations
 * every poll cycle), so `mintAttested` is idempotent: it consults the
 * recorded tx hash and the vault UTxO set before minting, guaranteeing a
 * deposit_id can never be minted twice by this service.
 */
import { createPublicKey } from "node:crypto";
import type pg from "pg";
import {
  CML,
  credentialToAddress,
  fromText,
  toText,
  toUnit,
  type UTxO,
} from "./lucid.js";
import {
  buildEarlyWithdrawTx,
  buildRedeemTx,
  maturePayout,
  readVaultDatum,
  type CDDatum,
  type CDTerms,
} from "../../cdt-txlib/src/index.ts";
import { buildVaultMintTx } from "./mint.js";
import {
  OracleWatcher,
  centsToLovelace,
  verifyAttestation,
  type SignedAttestation,
  type WatcherLogger,
} from "../../oracle-watcher/src/index.ts";
import type { CredentialDirectory } from "./credentials.js";
import type { ChainContext } from "./provider.js";

export interface MintOutcome {
  depositId: string;
  /** policyId + assetName of the CDT. */
  unit: string;
  txHash: string;
  /** True when the deposit had already been minted (idempotent re-delivery). */
  alreadyMinted: boolean;
  /** Lovelace locked at the vault (principal + full interest). */
  lockedLovelace: bigint;
}

export interface RedeemOutcome {
  depositId: string;
  kind: "redeem" | "early_withdraw";
  unit: string;
  txHash: string;
  principal: bigint;
  /** Full interest (redeem) or interest accrued at the withdrawal time. */
  interest: bigint;
  /** Early-withdrawal penalty withheld from the accrued interest (0 at maturity). */
  penalty: bigint;
  /** Lovelace paid to the member. */
  payout: bigint;
  /** Lovelace returned to the issuer (early withdrawal only). */
  remainder: bigint;
  /** Effective (slot-aligned) time the payout was computed at, POSIX ms. */
  effectiveAt: bigint;
}

export interface StatusRow {
  depositId: string;
  member: string;
  product: string | null;
  principal: bigint;
  rateBps: number;
  start: number;
  maturity: number;
  mintTxHash: string | null;
  redeemTxHash: string | null;
  state: string;
}

export type MintInterceptor = (
  attestation: SignedAttestation,
  mint: () => Promise<MintOutcome>,
) => Promise<MintOutcome>;

export interface IssuanceServiceOptions {
  pool: pg.Pool;
  chain: ChainContext;
  directory: CredentialDirectory;
  log?: WatcherLogger;
  pollIntervalMs?: number;
  /** Give up re-trying a failing mint after this many attempts (default 10). */
  maxMintAttempts?: number;
  /** Preview mode: the member's bech32 key for redemptions (from env file). */
  memberKey?: string;
  /** Test hook: wraps every mint triggered by an attestation delivery. */
  interceptMint?: MintInterceptor;
}

export class IssuanceService {
  readonly watcher: OracleWatcher;
  private readonly pool: pg.Pool;
  private readonly chain: ChainContext;
  private readonly directory: CredentialDirectory;
  private readonly log: WatcherLogger;
  private readonly maxMintAttempts: number;
  private readonly memberKey: string | undefined;
  private readonly interceptMint: MintInterceptor | undefined;
  /** wallet vkh (hex) -> bech32 private key, for member wallets we control. */
  private readonly memberKeyByVkh = new Map<string, string>();
  private readonly mintAttempts = new Map<string, number>();
  /**
   * Serializes every wallet-mutating chain operation. The Lucid instance has
   * ONE active wallet, and the watcher's mints (issuer wallet) run on the
   * same event loop as control-server redeems (member wallet) — without
   * this lock, an interleaved `selectWallet` would sign one party's tx with
   * the other party's key.
   */
  private chainLock: Promise<void> = Promise.resolve();

  constructor(options: IssuanceServiceOptions) {
    this.pool = options.pool;
    this.chain = options.chain;
    this.directory = options.directory;
    this.log = options.log ?? console;
    this.maxMintAttempts = options.maxMintAttempts ?? 10;
    this.memberKey = options.memberKey;
    this.interceptMint = options.interceptMint;
    for (const wallet of this.chain.memberWallets) {
      this.memberKeyByVkh.set(wallet.vkh, wallet.privateKey);
    }
    this.watcher = new OracleWatcher({
      pool: this.pool,
      oraclePrivateKey: this.chain.oracleAttestationKey,
      verifyPresentation: this.directory.verifyHook(),
      onAttested: (attestation) => this.handleAttested(attestation),
      pollIntervalMs: options.pollIntervalMs ?? 2000,
      log: this.log,
      now: () => this.chain.now(),
    });
  }

  /**
   * Boot ceremony: enroll members into the credential directory; in
   * emulator mode, assign every member a pre-funded emulator wallet (the
   * seeded wallet addresses are placeholders that cannot receive a CDT);
   * in preview mode, recover attested-but-unminted deposits left behind by
   * a crash or a previous give-up (the watcher only re-delivers in-memory).
   */
  async boot(): Promise<void> {
    const enrolled = await this.directory.enrollFromAccounts(this.pool);
    this.log.info(
      `pipeline: credential ceremony complete — NCUA ${this.directory.ncua.did} -> ` +
        `credit union ${this.directory.creditUnion.did} -> ${enrolled} enrolled member(s)`,
    );
    if (this.chain.mode === "emulator") {
      await this.assignEmulatorWallets();
    }
    await this.recoverPendingMints();
  }

  /**
   * Re-drive minting for attestations that never got a tx hash (crash
   * between attest and mint, or a previous run's give-up). Only meaningful
   * on a persistent chain: the emulator's ledger dies with its process, so
   * there stale attestations are reported but unrecoverable.
   */
  private async recoverPendingMints(): Promise<void> {
    const { rows } = await this.pool.query(
      `SELECT deposit_id, payload FROM attestations
        WHERE payload->>'tx_hash' IS NULL
        ORDER BY transaction_id`,
    );
    if (rows.length === 0) return;
    if (this.chain.mode !== "preview") {
      this.log.warn(
        `pipeline: ${rows.length} attested deposit(s) in the bank DB have no recorded mint; ` +
          "the emulator chain is fresh, so they cannot be recovered (re-seed the database for a clean demo)",
      );
      return;
    }
    this.log.info(
      `pipeline: recovering ${rows.length} attested-but-unminted deposit(s)`,
    );
    for (const row of rows) {
      try {
        await this.handleAttested(row.payload as SignedAttestation);
      } catch (err) {
        this.log.error(
          `pipeline: recovery mint for deposit ${row.deposit_id} failed (will keep retrying up to the attempt cap on later boots): ${String(err)}`,
        );
      }
    }
  }

  private async assignEmulatorWallets(): Promise<void> {
    const { rows } = await this.pool.query(
      "SELECT DISTINCT member_name FROM accounts ORDER BY member_name",
    );
    const wallets = this.chain.memberWallets;
    if (rows.length > wallets.length) {
      this.log.warn(
        `pipeline: ${rows.length} members but only ${wallets.length} emulator wallets; wallets will be shared`,
      );
    }
    for (const [i, row] of rows.entries()) {
      const wallet = wallets[i % wallets.length];
      if (!wallet) throw new Error("no emulator member wallets configured");
      await this.pool.query(
        "UPDATE accounts SET wallet_address = $1 WHERE member_name = $2",
        [wallet.address, row.member_name],
      );
      this.log.info(
        `pipeline: assigned emulator wallet ${wallet.address.slice(0, 24)}… to ${row.member_name}`,
      );
    }
  }

  /** Deliveries from the oracle watcher (at-least-once; see class docs). */
  private async handleAttested(attestation: SignedAttestation): Promise<void> {
    const depositId = attestation.payload.deposit_id;
    try {
      const mint = (): Promise<MintOutcome> => this.mintAttested(attestation);
      const outcome = this.interceptMint
        ? await this.interceptMint(attestation, mint)
        : await mint();
      this.mintAttempts.delete(depositId);
      if (!outcome.alreadyMinted) {
        this.log.info(
          `pipeline: minted CDT for deposit ${depositId}: tx ${outcome.txHash} ` +
            `(locked ${outcome.lockedLovelace} lovelace at the vault)`,
        );
      }
    } catch (err) {
      const attempts = (this.mintAttempts.get(depositId) ?? 0) + 1;
      this.mintAttempts.set(depositId, attempts);
      if (attempts >= this.maxMintAttempts) {
        this.mintAttempts.delete(depositId);
        this.log.error(
          `pipeline: giving up on deposit ${depositId} after ${attempts} mint attempts ` +
            `(a service restart retries it): ${String(err)}`,
        );
        return; // swallow: stop the redelivery loop for this attestation
      }
      throw err; // watcher re-queues and re-delivers next poll cycle
    }
  }

  /** Run `fn` with exclusive access to the chain context's active wallet. */
  private withChainLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chainLock.then(fn);
    this.chainLock = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * Mint the CDT for a signed attestation. Idempotent: if the bank DB
   * already records a mint tx hash for the deposit, or the vault already
   * holds the deposit's asset, no second mint is attempted. The tx hash is
   * written back immediately after submission (before confirmation), so a
   * confirmation timeout followed by a re-delivery cannot double-mint.
   */
  mintAttested(attestation: SignedAttestation): Promise<MintOutcome> {
    return this.withChainLock(() => this.mintAttestedLocked(attestation));
  }

  private async mintAttestedLocked(
    attestation: SignedAttestation,
  ): Promise<MintOutcome> {
    const { chain } = this;
    const payload = attestation.payload;
    const depositId = payload.deposit_id;
    const assetName = fromText(depositId);
    const unit = toUnit(chain.scripts.policyId, assetName);

    if (
      !verifyAttestation(
        attestation,
        createPublicKey(chain.oracleAttestationKey),
      )
    ) {
      throw new Error(
        `attestation for deposit ${depositId} has an invalid oracle signature`,
      );
    }

    const { rows } = await this.pool.query(
      "SELECT payload->>'tx_hash' AS tx_hash FROM attestations WHERE deposit_id = $1",
      [depositId],
    );
    if (rows.length === 0) {
      throw new Error(`no attestation row in the bank DB for deposit ${depositId}`);
    }
    const recorded = rows[0].tx_hash as string | null;
    const lockedLovelace = maturePayout(
      BigInt(payload.principal),
      BigInt(payload.rate_bps),
      BigInt(payload.start),
      BigInt(payload.maturity),
    );
    if (recorded) {
      return {
        depositId,
        unit,
        txHash: recorded,
        alreadyMinted: true,
        lockedLovelace,
      };
    }

    // On-chain guard: a mint may have landed whose tx hash never made it
    // into the DB (crash between submit and write-back). Reconcile instead
    // of double-minting.
    const existing = await chain.lucid.utxosAtWithUnit(
      chain.scripts.vaultAddress,
      unit,
    );
    if (existing.length > 0) {
      const txHash = existing[0]!.txHash;
      await this.writeMintTxHash(depositId, txHash, unit);
      this.log.warn(
        `pipeline: deposit ${depositId} was already minted on-chain (tx ${txHash}); reconciled the bank record`,
      );
      return { depositId, unit, txHash, alreadyMinted: true, lockedLovelace };
    }

    const terms: CDTerms = {
      issuer: chain.issuer.vkh,
      depositId: assetName,
      principal: BigInt(payload.principal),
      rateBps: BigInt(payload.rate_bps),
      start: BigInt(payload.start),
      maturity: BigInt(payload.maturity),
      penaltyBps: BigInt(payload.penalty_bps),
    };

    chain.selectWallet(chain.issuer.privateKey);
    const built = await buildVaultMintTx(chain.lucid, {
      scripts: chain.scripts,
      ownerAddress: payload.owner,
      terms,
    });
    const issuerWitness = await built.tx.partialSign.withWallet();
    const oracleWitness = await built.tx.partialSign.withPrivateKey(
      chain.oracle.privateKey,
    );
    const signed = await built.tx
      .assemble([issuerWitness, oracleWitness])
      .complete();
    const txHash = await signed.submit();
    // Record the hash BEFORE awaiting confirmation: if confirmation times
    // out and the watcher re-delivers, the DB guard above must already see
    // the submitted tx or a second mint could race the first one.
    await this.writeMintTxHash(depositId, txHash, unit);
    await chain.awaitTx(txHash);

    return {
      depositId,
      unit,
      txHash,
      alreadyMinted: false,
      lockedLovelace: built.lockedLovelace,
    };
  }

  /** Merge the mint tx hash into the bank DB's attestations.payload JSONB. */
  private async writeMintTxHash(
    depositId: string,
    txHash: string,
    unit: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE attestations
          SET payload = payload || jsonb_build_object('tx_hash', $2::text, 'cdt_unit', $3::text)
        WHERE deposit_id = $1`,
      [depositId, txHash, unit],
    );
  }

  /** Look up the (single) vault UTxO holding the deposit's CDT. */
  async findVaultUtxo(
    depositId: string,
  ): Promise<{ unit: string; utxo: UTxO; datum: CDDatum } | undefined> {
    const { chain } = this;
    const unit = toUnit(chain.scripts.policyId, fromText(depositId));
    const utxos = await chain.lucid.utxosAtWithUnit(
      chain.scripts.vaultAddress,
      unit,
    );
    const utxo = utxos[0];
    if (!utxo) return undefined;
    return { unit, utxo, datum: readVaultDatum(utxo, chain.scripts) };
  }

  /**
   * Redeem a CD (at/after maturity) or early-withdraw it (`early: true`),
   * signing with the member's key. This is the code path behind both the
   * redeem CLI and the control server.
   */
  redeem(options: {
    depositId: string;
    early?: boolean;
  }): Promise<RedeemOutcome> {
    return this.withChainLock(() => this.redeemLocked(options));
  }

  private async redeemLocked(options: {
    depositId: string;
    early?: boolean;
  }): Promise<RedeemOutcome> {
    const { chain } = this;
    const { depositId, early = false } = options;
    const found = await this.findVaultUtxo(depositId);
    if (!found) {
      throw new Error(
        `deposit ${depositId} has no vault UTxO — it is not minted yet, or was already redeemed`,
      );
    }
    const { unit, utxo, datum } = found;

    // The watcher stores the whole SignedAttestation as `payload`, so the
    // attested owner address lives at payload -> payload -> owner.
    const { rows } = await this.pool.query(
      "SELECT payload#>>'{payload,owner}' AS owner FROM attestations WHERE deposit_id = $1",
      [depositId],
    );
    const ownerAddress =
      (rows[0]?.owner as string | undefined) ??
      credentialToAddress(chain.network, { type: "Key", hash: datum.owner });

    const memberKey =
      this.memberKeyByVkh.get(datum.owner) ?? this.memberKey;
    if (!memberKey) {
      throw new Error(
        `no signing key available for the CD owner (${datum.owner}); point CDT_MEMBER_SK_FILE at the member's key`,
      );
    }
    // Fail fast with a clear error instead of submitting a transaction the
    // vault validator will reject for a missing owner signature.
    const memberVkh = CML.PrivateKey.from_bech32(memberKey)
      .to_public()
      .hash()
      .to_hex();
    if (memberVkh !== datum.owner) {
      throw new Error(
        `the member signing key (vkh ${memberVkh}) does not own this CD ` +
          `(datum owner ${datum.owner}); point CDT_MEMBER_SK_FILE at the right member's key`,
      );
    }
    chain.selectWallet(memberKey);

    if (early) {
      const withdrawAt = BigInt(chain.now());
      const built = await buildEarlyWithdrawTx(chain.lucid, {
        blueprint: chain.blueprint,
        oracleVkh: chain.oracle.vkh,
        scripts: chain.scripts,
        vaultUtxo: utxo,
        ownerAddress,
        issuerAddress:
          datum.issuer === chain.issuer.vkh
            ? chain.issuer.address
            : credentialToAddress(chain.network, {
                type: "Key",
                hash: datum.issuer,
              }),
        withdrawAt,
      });
      // The effective time is aligned UP to a slot boundary; make sure the
      // chain has reached it before submitting (advance the emulator, or
      // sleep out the sub-slot remainder on a real network).
      await chain.waitUntil(Number(built.validFrom));
      const signed = await built.tx.sign.withWallet().complete();
      const txHash = await signed.submit();
      await chain.awaitTx(txHash);
      await this.writeRedeemTxHash(depositId, txHash, "early_withdraw");
      return {
        depositId,
        kind: "early_withdraw",
        unit,
        txHash,
        principal: datum.principal,
        interest: built.accrued,
        penalty: built.penalty,
        payout: built.payout,
        remainder: built.remainder,
        effectiveAt: built.validFrom,
      };
    }

    if (BigInt(chain.now()) < datum.maturity) {
      if (chain.mode === "emulator") {
        this.log.info(
          `pipeline: advancing the emulator past maturity (${new Date(Number(datum.maturity)).toISOString()})`,
        );
        await chain.waitUntil(Number(datum.maturity) + 1000);
      } else {
        throw new Error(
          `deposit ${depositId} matures at ${new Date(Number(datum.maturity)).toISOString()}; ` +
            "pass --early to withdraw early (with penalty)",
        );
      }
    }
    const built = await buildRedeemTx(chain.lucid, {
      blueprint: chain.blueprint,
      oracleVkh: chain.oracle.vkh,
      scripts: chain.scripts,
      vaultUtxo: utxo,
      ownerAddress,
    });
    await chain.waitUntil(Number(built.validFrom));
    const signed = await built.tx.sign.withWallet().complete();
    const txHash = await signed.submit();
    await chain.awaitTx(txHash);
    await this.writeRedeemTxHash(depositId, txHash, "redeem");
    return {
      depositId,
      kind: "redeem",
      unit,
      txHash,
      principal: datum.principal,
      interest: built.payout - datum.principal,
      penalty: 0n,
      payout: built.payout,
      remainder: 0n,
      effectiveAt: built.validFrom,
    };
  }

  private async writeRedeemTxHash(
    depositId: string,
    txHash: string,
    kind: "redeem" | "early_withdraw",
  ): Promise<void> {
    await this.pool.query(
      `UPDATE attestations
          SET payload = payload || jsonb_build_object('redeem_tx_hash', $2::text, 'redeem_kind', $3::text)
        WHERE deposit_id = $1`,
      [depositId, txHash, kind],
    );
  }

  /**
   * Join the bank DB's view of every CD with the on-chain vault state.
   * Also lists CD deposits the oracle has not attested yet.
   */
  async status(): Promise<StatusRow[]> {
    const { chain } = this;
    // The three fetches are independent; run them concurrently.
    const [vaultUtxos, attested, pending] = await Promise.all([
      chain.lucid.utxosAt(chain.scripts.vaultAddress),
      this.pool.query(
        `SELECT a.deposit_id, a.payload, acc.member_name, p.name AS product_name
           FROM attestations a
           JOIN transactions t ON t.id = a.transaction_id
           JOIN accounts acc   ON acc.id = t.account_id
           LEFT JOIN cd_products p ON p.id = t.product_id
          ORDER BY a.transaction_id`,
      ),
      this.pool.query(
        `SELECT t.id, t.amount_cents, acc.member_name, p.name AS product_name,
                p.rate_bps
           FROM transactions t
           JOIN accounts acc   ON acc.id = t.account_id
           JOIN cd_products p  ON p.id = t.product_id
          WHERE t.kind = 'deposit' AND t.attested = false AND acc.kind = 'cd_funding'
          ORDER BY t.id`,
      ),
    ]);

    const onChain = new Map<string, CDDatum>();
    for (const utxo of vaultUtxos) {
      try {
        const datum = readVaultDatum(utxo, chain.scripts);
        onChain.set(toText(datum.deposit_id), datum);
      } catch {
        // Foreign/hostile UTxO parked at the vault address; not one of ours.
      }
    }

    const rows: StatusRow[] = [];
    const now = chain.now();
    for (const row of attested.rows) {
      // The stored JSONB is the whole SignedAttestation (CD terms nested
      // under .payload); the pipeline's write-backs (tx_hash, redeem_*) are
      // merged at the top level.
      const stored = row.payload as Record<string, unknown>;
      const terms = (stored.payload ?? {}) as Record<string, unknown>;
      const depositId = String(row.deposit_id);
      const mintTxHash = (stored.tx_hash as string | undefined) ?? null;
      const redeemTxHash = (stored.redeem_tx_hash as string | undefined) ?? null;
      const minted = onChain.has(depositId);
      let state: string;
      if (!mintTxHash && !minted) {
        state = "attested — mint pending";
      } else if (redeemTxHash) {
        // A recorded redemption wins even while the spent vault UTxO is
        // still briefly observable (confirmation lag).
        state =
          stored.redeem_kind === "early_withdraw"
            ? "early-withdrawn"
            : "redeemed";
      } else if (minted) {
        state =
          now >= Number(terms.maturity)
            ? "minted — matured (redeemable)"
            : "minted — locked";
      } else {
        state = "redeemed (vault spent)";
      }
      rows.push({
        depositId,
        member: String(row.member_name),
        product: (row.product_name as string | null) ?? null,
        principal: BigInt((terms.principal as number | undefined) ?? 0),
        rateBps: Number(terms.rate_bps ?? 0),
        start: Number(terms.start ?? 0),
        maturity: Number(terms.maturity ?? 0),
        mintTxHash,
        redeemTxHash,
        state,
      });
    }

    for (const row of pending.rows) {
      rows.push({
        depositId: String(row.id),
        member: String(row.member_name),
        product: (row.product_name as string | null) ?? null,
        principal: centsToLovelace(BigInt(row.amount_cents)),
        rateBps: Number(row.rate_bps),
        start: 0,
        maturity: 0,
        mintTxHash: null,
        redeemTxHash: null,
        state: "awaiting attestation",
      });
    }
    return rows;
  }
}
