/**
 * Correspondent presentment + settlement network state machine.
 *
 * Flow (docs/network/05-messaging-protocol.md):
 *   pending_burn / quoted
 *     → authorized          (SettlementAuth issued, burn_required)
 *     → burn_submitted      (BurnEvidence recorded)
 *     → burn_accepted       (issuer accepts burn)
 *     → settled             (SettlementPayment recorded)
 *     → rejected
 *
 * Durable by default when a Postgres pool is provided (presentments table).
 * Falls back to in-memory for unit tests without schema.
 */
import type pg from "pg";
import type {
  CdDto,
  ClaimLookupDto,
  PresentmentDto,
  PresentmentRequest,
  PresentmentStatus,
  SignedSettlementAuthDto,
} from "../shared/types.js";
import { toCdDto, type CdRow } from "./cds.js";
import {
  SettlementSigner,
  type SignedSettlementAuth,
} from "./settlement-auth.js";
import {
  validateBurnTx,
  type BurnValidateMode,
  type BurnValidateResult,
} from "./burn-validate.js";
import type { SettlementRail } from "./settlement-rail.js";
import { MockAchRail } from "./settlement-rail.js";

export interface PresentmentStoreOptions {
  pool?: pg.Pool;
  signer?: SettlementSigner;
  /** On-chain burn validation settings (defaults: mode off). */
  burnValidation?: {
    mode: BurnValidateMode;
    provider?: string;
    koiosBaseUrl?: string;
    policyId?: string;
    fetchImpl?: typeof fetch;
  };
  /** Settlement payment rail (default MockAchRail). */
  settlementRail?: SettlementRail;
}

function toAuthDto(auth: SignedSettlementAuth): SignedSettlementAuthDto {
  return {
    payload: auth.payload,
    signature: auth.signature,
    algorithm: auth.algorithm,
    publicKeySpkiBase64: auth.publicKeySpkiBase64,
  };
}

const ISSUER_NAME = "CampusUSA Credit Union";
const PRESENTING_DEFAULT = "Gulfside Credit Union";

export interface ClaimRow extends CdRow {
  member_name: string;
  wallet_address: string;
  did: string;
  attested_flag: boolean;
}

const CLAIM_SQL = `
  SELECT t.id, t.amount_cents, t.memo, t.created_at, t.attested AS attested_flag,
         p.id AS product_id, p.name, p.term_months, p.rate_bps, p.penalty_bps,
         p.min_deposit_cents,
         att.deposit_id, att.payload,
         a.member_name, a.wallet_address, a.did
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN cd_products p ON p.id = t.product_id
    LEFT JOIN attestations att ON att.transaction_id = t.id
   WHERE t.kind = 'deposit'
     AND t.product_id IS NOT NULL
     AND (
       att.deposit_id = $1
       OR t.id::text = $1
       OR ($2::bigint IS NOT NULL AND t.id = $2)
     )
   ORDER BY t.id DESC
   LIMIT 1
`;

export function parseClaimRef(raw: string): { ref: string; asNumber: number | null } {
  const ref = raw.trim();
  const n = Number(ref);
  const asNumber = Number.isSafeInteger(n) && n > 0 ? n : null;
  return { ref, asNumber };
}

export async function lookupClaim(
  pool: pg.Pool,
  rawRef: string,
  nowMs: number,
): Promise<ClaimLookupDto | null> {
  const { ref, asNumber } = parseClaimRef(rawRef);
  if (!ref) return null;
  const { rows } = await pool.query(CLAIM_SQL, [ref, asNumber]);
  const row = rows[0] as ClaimRow | undefined;
  if (!row) return null;

  const cd = toCdDto(row, nowMs, false);
  const redeemable = cd.status === "active" || cd.status === "matured";
  const cashOutCents =
    cd.status === "matured" ? cd.maturityValueCents : cd.earlyPayoutTodayCents;

  return {
    claim: cd,
    issuerName: ISSUER_NAME,
    holderName: row.member_name,
    holderDid: row.did,
    holderWallet: row.wallet_address,
    redeemable,
    cashOutMode: cd.status === "matured" ? "mature" : cd.status === "active" ? "early" : "not_ready",
    cashOutCents: redeemable ? cashOutCents : null,
    notes: buildClaimNotes(cd),
  };
}

function buildClaimNotes(cd: CdDto): string[] {
  const notes: string[] = [];
  if (cd.status === "pending") {
    notes.push(
      "This deposit is not yet attested by the issuing credit union's oracle. Do not advance cash.",
    );
  }
  if (cd.status === "active") {
    notes.push(
      "Certificate is still in term. Cash-out uses early-withdrawal math (principal + accrued − penalty). Confirm the holder accepts the penalty before advancing funds.",
    );
  }
  if (cd.status === "matured") {
    notes.push(
      "Certificate is at or past maturity. Cash-out is principal + full contractual interest.",
    );
  }
  if (!cd.txHash) {
    notes.push(
      "No mint transaction hash is recorded yet. Prefer waiting for a tokenized (minted) claim, or settle only against issuer core confirmation.",
    );
  }
  notes.push(
    "You are not the issuer. Advancing cash creates a correspondent receivable against the issuing CU — the vault burn/redeem still requires the holder's key and the issuer's program rules.",
  );
  notes.push(
    "The insured deposit claim lives on the issuer's books (NCUSIF). Your advance is an uninsured inter-CU receivable until the issuer settles.",
  );
  notes.push(
    "Production path: obtain SettlementAuth, burn CDT, submit BurnEvidence, wait for BurnAccepted before unrestricted cash release.",
  );
  return notes;
}

function rowToDto(row: Record<string, unknown>): PresentmentDto {
  return {
    id: Number(row.id),
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    status: row.status as PresentmentStatus,
    presentingCuName: String(row.presenting_cu_name),
    issuerName: String(row.issuer_name),
    walkInName: String(row.walk_in_name),
    transactionId: Number(row.transaction_id),
    depositId: row.deposit_id != null ? String(row.deposit_id) : null,
    principalCents: Number(row.principal_cents),
    cashOutCents: Number(row.cash_out_cents),
    cashOutMode: row.cash_out_mode as "mature" | "early",
    productName: String(row.product_name),
    rateBps: Number(row.rate_bps),
    holderDid: String(row.holder_did),
    holderWallet: String(row.holder_wallet),
    settlement: String(row.settlement ?? ""),
    nextSteps: Array.isArray(row.next_steps)
      ? (row.next_steps as string[])
      : typeof row.next_steps === "string"
        ? (JSON.parse(row.next_steps) as string[])
        : [],
    settlementInstructions:
      row.settlement_instructions != null
        ? String(row.settlement_instructions)
        : undefined,
    settlementAuth: row.settlement_auth
      ? toAuthDto(row.settlement_auth as SignedSettlementAuth)
      : undefined,
    burnTxHash: row.burn_tx_hash != null ? String(row.burn_tx_hash) : undefined,
    burnMode: row.burn_mode != null ? String(row.burn_mode) : undefined,
    settlementPayment: (row.settlement_payment as PresentmentDto["settlementPayment"]) ?? undefined,
  };
}

const OPEN_STATUSES = new Set([
  "pending_burn",
  "authorized",
  "burn_submitted",
  "burn_accepted",
  "cash_advanced_pending_settlement",
]);

/** Presentment ledger — Postgres when available, memory otherwise. */
export class PresentmentStore {
  private seq = 1;
  private byId = new Map<number, PresentmentDto>();
  private byClaim = new Map<string, number[]>();
  private durable = false;
  private readonly pool?: pg.Pool;
  private readonly signer: SettlementSigner;
  private readonly burnValidation: PresentmentStoreOptions["burnValidation"];
  private readonly settlementRail: SettlementRail;

  constructor(poolOrOpts?: pg.Pool | PresentmentStoreOptions, signer?: SettlementSigner) {
    if (poolOrOpts && typeof (poolOrOpts as pg.Pool).query === "function") {
      this.pool = poolOrOpts as pg.Pool;
      this.signer = signer ?? new SettlementSigner();
      this.burnValidation = undefined;
      this.settlementRail = new MockAchRail();
    } else {
      const opts = (poolOrOpts as PresentmentStoreOptions | undefined) ?? {};
      this.pool = opts.pool;
      this.signer = opts.signer ?? signer ?? new SettlementSigner();
      this.burnValidation = opts.burnValidation;
      this.settlementRail = opts.settlementRail ?? new MockAchRail();
    }
  }
  /** Probe once whether the presentments table exists. */
  async init(): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query("SELECT 1 FROM presentments LIMIT 0");
      this.durable = true;
    } catch {
      this.durable = false;
    }
  }

  getSigner(): SettlementSigner {
    return this.signer;
  }

  async list(): Promise<PresentmentDto[]> {
    if (this.durable && this.pool) {
      const { rows } = await this.pool.query(
        `SELECT * FROM presentments ORDER BY id DESC`,
      );
      return rows.map(rowToDto);
    }
    return [...this.byId.values()].sort((a, b) => b.id - a.id);
  }

  async get(id: number): Promise<PresentmentDto | undefined> {
    if (this.durable && this.pool) {
      const { rows } = await this.pool.query(
        `SELECT * FROM presentments WHERE id = $1`,
        [id],
      );
      return rows[0] ? rowToDto(rows[0]) : undefined;
    }
    return this.byId.get(id);
  }

  async findOpenForClaim(claimKey: string): Promise<PresentmentDto | undefined> {
    if (this.durable && this.pool) {
      const { rows } = await this.pool.query(
        `SELECT * FROM presentments
          WHERE deposit_id = $1
            AND status = ANY($2::text[])
          ORDER BY id DESC LIMIT 1`,
        [claimKey, [...OPEN_STATUSES]],
      );
      return rows[0] ? rowToDto(rows[0]) : undefined;
    }
    const ids = this.byClaim.get(claimKey) ?? [];
    for (const id of ids) {
      const p = this.byId.get(id);
      if (p && OPEN_STATUSES.has(p.status)) return p;
    }
    return undefined;
  }

  async create(input: {
    claim: ClaimLookupDto;
    body: PresentmentRequest;
    nowMs: number;
  }): Promise<PresentmentDto | { error: string; status: number }> {
    const { claim, body, nowMs } = input;
    if (!claim.redeemable || claim.cashOutCents === null) {
      return {
        error: "Claim is not redeemable for cash at this desk (pending or unattested).",
        status: 422,
      };
    }
    if (!body.checks?.cip || !body.checks?.ofac || !body.checks?.ownershipProof) {
      return {
        error: "CIP, OFAC, and ownership-proof checks must all be confirmed.",
        status: 422,
      };
    }
    if (!body.walkInName || typeof body.walkInName !== "string" || !body.walkInName.trim()) {
      return { error: "walkInName is required.", status: 400 };
    }
    const presentingCu =
      typeof body.presentingCuName === "string" && body.presentingCuName.trim()
        ? body.presentingCuName.trim()
        : PRESENTING_DEFAULT;

    const claimKey = claim.claim.depositId ?? String(claim.claim.transactionId);
    const existing = await this.findOpenForClaim(claimKey);
    if (existing) {
      return {
        error: `An open presentment (#${existing.id}) already exists for this claim.`,
        status: 409,
      };
    }

    const walkIn = body.walkInName.trim();
    if (walkIn.toLowerCase() !== claim.holderName.toLowerCase()) {
      return {
        error: `Walk-in name must match the certificate holder on the issuer's books (${claim.holderName}).`,
        status: 422,
      };
    }

    const mode = claim.cashOutMode === "mature" ? "mature" : "early";
    const nextSteps = [
      "Do NOT advance unrestricted cash yet — place hold or wait for burn.",
      "Request SettlementAuth from issuer (POST …/authorize).",
      "Obtain holder wallet signature for Redeem or EarlyWithdraw.",
      "Submit burn tx hash as BurnEvidence; wait for BurnAccepted + core close.",
      "Only then release credit / cash; ACH settlement follows.",
    ];
    const settlementInstructions = [
      "DO NOT advance unrestricted cash until burn evidence is accepted.",
      `1. Obtain SettlementAuth (signed, TTL, burn_required=true).`,
      `2. Co-sign ${mode === "mature" ? "Redeem" : "EarlyWithdraw"} burn for CDT ${claimKey}.`,
      "3. POST BurnEvidence with Cardano tx_hash; wait for BurnAccepted.",
      `4. Issuer settles ${claim.cashOutCents} cents to ${presentingCu}.`,
      "NCUSIF coverage remains with the issuing CU until the certificate is closed on its books.",
    ].join("\n");

    const settlement =
      mode === "mature"
        ? `HOLD FUNDS until burn. Mature settlement of $${(claim.cashOutCents / 100).toFixed(2)} from ${claim.issuerName} against deposit ${claimKey}.`
        : `HOLD FUNDS until burn. Early-withdrawal settlement of $${(claim.cashOutCents / 100).toFixed(2)} (penalty applied) from ${claim.issuerName} against deposit ${claimKey}.`;

    if (this.durable && this.pool) {
      const { rows } = await this.pool.query(
        `INSERT INTO presentments (
           deposit_id, transaction_id, status, presenting_cu_name, issuer_name,
           walk_in_name, principal_cents, cash_out_cents, cash_out_mode,
           product_name, rate_bps, holder_did, holder_wallet, settlement,
           next_steps, settlement_instructions
         ) VALUES (
           $1,$2,'pending_burn',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15
         ) RETURNING *`,
        [
          claimKey,
          claim.claim.transactionId,
          presentingCu,
          claim.issuerName,
          walkIn,
          claim.claim.principalCents,
          claim.cashOutCents,
          mode,
          claim.claim.product.name,
          claim.claim.rateBps,
          claim.holderDid,
          claim.holderWallet,
          settlement,
          JSON.stringify(nextSteps),
          settlementInstructions,
        ],
      );
      return rowToDto(rows[0]);
    }

    const id = this.seq++;
    const dto: PresentmentDto = {
      id,
      createdAt: new Date(nowMs).toISOString(),
      status: "pending_burn",
      presentingCuName: presentingCu,
      issuerName: claim.issuerName,
      walkInName: walkIn,
      transactionId: claim.claim.transactionId,
      depositId: claim.claim.depositId,
      principalCents: claim.claim.principalCents,
      cashOutCents: claim.cashOutCents,
      cashOutMode: mode,
      productName: claim.claim.product.name,
      rateBps: claim.claim.rateBps,
      holderDid: claim.holderDid,
      holderWallet: claim.holderWallet,
      settlement,
      nextSteps,
      settlementInstructions,
    };
    this.byId.set(id, dto);
    const list = this.byClaim.get(claimKey) ?? [];
    list.push(id);
    this.byClaim.set(claimKey, list);
    return dto;
  }

  async authorize(
    id: number,
    nowMs: number,
  ): Promise<PresentmentDto | { error: string; status: number }> {
    const p = await this.get(id);
    if (!p) return { error: "Presentment not found.", status: 404 };
    if (p.status !== "pending_burn" && p.status !== "authorized") {
      return {
        error: `Cannot authorize presentment in status ${p.status}.`,
        status: 422,
      };
    }
    const depositId = p.depositId ?? String(p.transactionId);
    const auth = this.signer.issue({
      presentmentId: `pres_${id}`,
      depositId,
      redeemerInstitutionId: p.presentingCuName,
      cashOutCents: p.cashOutCents,
      cashOutMode: p.cashOutMode,
      nowMs,
    });
    return this.update(
      id,
      {
        status: "authorized",
        settlementAuth: toAuthDto(auth),
        nextSteps: [
          "SettlementAuth issued — verify signature with issuer public key.",
          "Burn CDT (Redeem / EarlyWithdraw) with holder co-sign.",
          "POST BurnEvidence with the Cardano tx hash.",
        ],
      },
      { eventType: "authorize", detail: { presentment_id: auth.payload.presentment_id } },
    );
  }

  async submitBurnEvidence(
    id: number,
    body: { txHash: string; mode?: string },
    nowMs: number = Date.now(),
  ): Promise<PresentmentDto | { error: string; status: number }> {
    const p = await this.get(id);
    if (!p) return { error: "Presentment not found.", status: 404 };
    if (p.status !== "authorized" && p.status !== "pending_burn") {
      return {
        error: `Burn evidence only accepted when authorized (or pending_burn lab). Status=${p.status}.`,
        status: 422,
      };
    }
    if (p.status === "pending_burn") {
      return {
        error: "Issue SettlementAuth first (POST …/authorize).",
        status: 422,
      };
    }
    const txHash = body.txHash?.trim().toLowerCase() ?? "";
    if (!/^[0-9a-f]{64}$/.test(txHash)) {
      return { error: "txHash must be a 64-char hex Cardano transaction id.", status: 400 };
    }
    if (!p.settlementAuth) {
      return { error: "Missing SettlementAuth on presentment.", status: 422 };
    }
    const authDeposit = p.settlementAuth.payload.deposit_id;
    const claimDeposit = p.depositId ?? String(p.transactionId);
    if (authDeposit !== claimDeposit) {
      return {
        error: `SettlementAuth deposit_id (${authDeposit}) does not match presentment (${claimDeposit}).`,
        status: 422,
      };
    }
    const authCheck = this.signer.verify(
      {
        payload: p.settlementAuth.payload,
        signature: p.settlementAuth.signature,
        algorithm: p.settlementAuth.algorithm,
        publicKeySpkiBase64: p.settlementAuth.publicKeySpkiBase64,
      },
      nowMs,
    );
    if (!authCheck.ok) {
      return { error: `SettlementAuth invalid: ${authCheck.reason}`, status: 422 };
    }
    const mode =
      body.mode === "redeem" || body.mode === "mature"
        ? "redeem"
        : body.mode === "early_withdraw" || body.mode === "early"
          ? "early_withdraw"
          : p.cashOutMode === "mature"
            ? "redeem"
            : "early_withdraw";

    // Unique burn: one tx_hash per presentment network-wide (durable UNIQUE).
    try {
      return await this.update(
        id,
        {
          status: "burn_submitted",
          burnTxHash: txHash,
          burnMode: mode,
          nextSteps: [
            "BurnEvidence recorded — issuer validates on-chain / indexer.",
            "Await BurnAccepted then SettlementPayment.",
          ],
        },
        { eventType: "burn_evidence", detail: { txHash, mode } },
      );
    } catch (err) {
      const msg = String(err);
      if (/unique|duplicate/i.test(msg)) {
        return {
          error: "This burn tx_hash is already linked to another presentment (double-burn guard).",
          status: 409,
        };
      }
      throw err;
    }
  }

  async acceptBurn(
    id: number,
    nowMs: number = Date.now(),
  ): Promise<
    | (PresentmentDto & { burnValidation?: BurnValidateResult })
    | { error: string; status: number; reasonCode?: string }
  > {
    const p = await this.get(id);
    if (!p) return { error: "Presentment not found.", status: 404 };
    if (p.status !== "burn_submitted") {
      return { error: `Cannot accept burn in status ${p.status}.`, status: 422 };
    }
    if (!p.burnTxHash) {
      return { error: "No burn tx hash on presentment.", status: 422 };
    }
    if (!p.settlementAuth) {
      return { error: "Missing SettlementAuth.", status: 422 };
    }
    const authCheck = this.signer.verify(
      {
        payload: p.settlementAuth.payload,
        signature: p.settlementAuth.signature,
        algorithm: p.settlementAuth.algorithm,
        publicKeySpkiBase64: p.settlementAuth.publicKeySpkiBase64,
      },
      nowMs,
    );
    if (!authCheck.ok) {
      return {
        error: `SettlementAuth invalid at accept: ${authCheck.reason}`,
        status: 422,
        reasonCode: "AUTH_EXPIRED",
      };
    }

    const depositId = p.settlementAuth.payload.deposit_id;
    const claimDeposit = p.depositId ?? String(p.transactionId);
    if (depositId !== claimDeposit) {
      return {
        error: "SettlementAuth deposit_id mismatch at accept-burn.",
        status: 422,
        reasonCode: "TX_INVALID",
      };
    }
    const bv = this.burnValidation;
    const validation = await validateBurnTx({
      provider: bv?.provider,
      koiosBaseUrl: bv?.koiosBaseUrl ?? "https://preview.koios.rest/api/v1",
      txHash: p.burnTxHash,
      depositId,
      policyId: bv?.policyId,
      mode: bv?.mode ?? "off",
      fetchImpl: bv?.fetchImpl,
    });

    if (!validation.ok) {
      return {
        error: validation.reason,
        status: validation.reasonCode === "TX_NOT_FOUND" ? 404 : 422,
        reasonCode: validation.reasonCode,
      };
    }

    const updated = await this.update(
      id,
      {
        status: "burn_accepted",
        nextSteps: [
          validation.onChain
            ? `Burn accepted on-chain (${validation.burnedQuantity ?? "qty n/a"}). Issuer closes deposit on core.`
            : "Burn accepted (lab / soft validation). Issuer closes deposit on core.",
          "Record SettlementPayment (ACH/wire) to complete.",
        ],
      },
      {
        eventType: "burn_accepted",
        detail: { burnValidation: validation, depositId },
      },
    );
    return { ...updated, burnValidation: validation };
  }
  async recordSettlementPayment(
    id: number,
    payment: { amountCents: number; rail?: string; traceId?: string; paidAt?: string },
    nowMs: number,
  ): Promise<PresentmentDto | { error: string; status: number }> {
    const p = await this.get(id);
    if (!p) return { error: "Presentment not found.", status: 404 };
    if (p.status !== "burn_accepted") {
      return {
        error: `SettlementPayment only after burn_accepted (status=${p.status}).`,
        status: 422,
      };
    }
    if (
      !Number.isSafeInteger(payment.amountCents) ||
      payment.amountCents !== p.cashOutCents
    ) {
      return {
        error: `amountCents must equal authorized cash-out (${p.cashOutCents}).`,
        status: 422,
      };
    }

    // If client supplies rail+traceId, record as-is (manual/external rail).
    // Otherwise invoke the configured SettlementRail (mock ACH by default).
    let rail = payment.rail;
    let traceId = payment.traceId;
    let paidAt = payment.paidAt;
    if (!rail || !traceId) {
      const railResult = await this.settlementRail.pay(
        {
          presentmentId: id,
          amountCents: payment.amountCents,
          currency: "USD",
          beneficiaryRef: p.presentingCuName,
          originatorRef: p.issuerName,
          depositId: p.depositId ?? String(p.transactionId),
          memo: `CDT settlement presentment ${id}`,
        },
        nowMs,
      );
      if (!railResult.ok) {
        return { error: railResult.reason, status: 422 };
      }
      rail = railResult.rail;
      traceId = railResult.traceId;
      paidAt = railResult.paidAt;
    }

    return this.update(
      id,
      {
        status: "settled",
        settlementPayment: {
          amountCents: payment.amountCents,
          rail,
          traceId,
          paidAt: paidAt ?? new Date(nowMs).toISOString(),
        },
        nextSteps: ["Settled. Terminal state."],
      },
      {
        eventType: "settlement_payment",
        detail: { rail, traceId, amountCents: payment.amountCents },
      },
    );
  }

  async listEvents(presentmentId: number): Promise<
    Array<{
      id: number;
      fromStatus: string | null;
      toStatus: string;
      eventType: string;
      detail: unknown;
      actor: string;
      createdAt: string;
    }>
  > {
    if (this.durable && this.pool) {
      try {
        const { rows } = await this.pool.query(
          `SELECT id, from_status, to_status, event_type, detail, actor, created_at
             FROM presentment_events
            WHERE presentment_id = $1
            ORDER BY id ASC`,
          [presentmentId],
        );
        return rows.map((r) => ({
          id: Number(r.id),
          fromStatus: r.from_status != null ? String(r.from_status) : null,
          toStatus: String(r.to_status),
          eventType: String(r.event_type),
          detail: r.detail,
          actor: String(r.actor),
          createdAt: new Date(r.created_at as string | Date).toISOString(),
        }));
      } catch {
        return [];
      }
    }
    return this.memoryEvents.get(presentmentId) ?? [];
  }

  private memoryEvents = new Map<
    number,
    Array<{
      id: number;
      fromStatus: string | null;
      toStatus: string;
      eventType: string;
      detail: unknown;
      actor: string;
      createdAt: string;
    }>
  >();
  private memoryEventSeq = 1;

  private async update(
    id: number,
    patch: Partial<PresentmentDto>,
    event?: { eventType: string; detail?: unknown; actor?: string },
  ): Promise<PresentmentDto> {
    if (this.durable && this.pool) {
      const current = await this.get(id);
      if (!current) throw new Error(`presentment ${id} missing`);
      const next = { ...current, ...patch };
      const { rows } = await this.pool.query(
        `UPDATE presentments SET
           status = $2,
           settlement = $3,
           next_steps = $4::jsonb,
           settlement_instructions = $5,
           settlement_auth = $6::jsonb,
           burn_tx_hash = $7,
           burn_mode = $8,
           settlement_payment = $9::jsonb,
           updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          id,
          next.status,
          next.settlement,
          JSON.stringify(next.nextSteps),
          next.settlementInstructions ?? null,
          next.settlementAuth ? JSON.stringify(next.settlementAuth) : null,
          next.burnTxHash ?? null,
          next.burnMode ?? null,
          next.settlementPayment ? JSON.stringify(next.settlementPayment) : null,
        ],
      );
      const dto = rowToDto(rows[0]);
      if (event && current.status !== dto.status) {
        try {
          await this.pool.query(
            `INSERT INTO presentment_events (presentment_id, from_status, to_status, event_type, detail, actor)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
            [
              id,
              current.status,
              dto.status,
              event.eventType,
              JSON.stringify(event.detail ?? {}),
              event.actor ?? "system",
            ],
          );
        } catch {
          // presentment_events may be missing on older volumes
        }
      }
      return dto;
    }
    const current = this.byId.get(id);
    if (!current) throw new Error(`presentment ${id} missing`);
    const next = { ...current, ...patch };
    this.byId.set(id, next);
    if (event && current.status !== next.status) {
      const list = this.memoryEvents.get(id) ?? [];
      list.push({
        id: this.memoryEventSeq++,
        fromStatus: current.status,
        toStatus: next.status,
        eventType: event.eventType,
        detail: event.detail ?? {},
        actor: event.actor ?? "system",
        createdAt: new Date().toISOString(),
      });
      this.memoryEvents.set(id, list);
    }
    return next;
  }
}

export const defaultPresentingCu = PRESENTING_DEFAULT;
export const defaultIssuerName = ISSUER_NAME;
