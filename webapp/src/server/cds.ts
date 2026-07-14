/**
 * CD status derivation and payout projection.
 *
 * A CD-funding deposit's lifecycle:
 *   pending  — transactions row exists, no attestation yet (oracle hasn't
 *              verified/signed it).
 *   active   — attestation exists and now < payload.maturity.
 *   matured  — attestation exists and now >= payload.maturity.
 *
 * All projections are computed with @cdt/txlib's interest math (bigint,
 * floor division — identical to the on-chain validator) in lovelace, then
 * floor-converted back to cents for display.
 */
import type { CdDto, CdStatus, CurvePoint, ProductDto } from "../shared/types.js";
import {
  ESTIMATED_MS_PER_MONTH,
  accrued,
  centsToLovelace,
  earlyPayout,
  lovelaceToCents,
  maturePayout,
  penaltyFee,
} from "./math.js";

/** Shape of the oracle watcher's signed attestation payload (jsonb column). */
interface SignedAttestationLike {
  payload?: {
    deposit_id?: unknown;
    owner?: unknown;
    principal?: unknown; // lovelace
    rate_bps?: unknown;
    start?: unknown; // epoch ms
    maturity?: unknown; // epoch ms
    penalty_bps?: unknown;
    tx_hash?: unknown;
  };
  tx_hash?: unknown;
}

/** Row returned by CDS_SQL below (pg maps BIGINT to string). */
export interface CdRow {
  id: number;
  amount_cents: string;
  memo: string | null;
  created_at: Date;
  product_id: number;
  name: string;
  term_months: number;
  rate_bps: number;
  penalty_bps: number;
  min_deposit_cents: string;
  deposit_id: string | null;
  payload: unknown;
}

export const CDS_SQL = `
  SELECT t.id, t.amount_cents, t.memo, t.created_at,
         p.id AS product_id, p.name, p.term_months, p.rate_bps, p.penalty_bps,
         p.min_deposit_cents,
         att.deposit_id, att.payload
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN cd_products p ON p.id = t.product_id
    LEFT JOIN attestations att ON att.transaction_id = t.id
   WHERE a.wallet_address = $1 AND a.did = $2
     AND t.kind = 'deposit' AND t.product_id IS NOT NULL
   ORDER BY t.created_at DESC, t.id DESC
`;

export function productDtoFromRow(row: {
  product_id: number;
  name: string;
  term_months: number;
  rate_bps: number;
  penalty_bps: number;
  min_deposit_cents: string;
}): ProductDto {
  return {
    id: row.product_id,
    name: row.name,
    termMonths: row.term_months,
    rateBps: row.rate_bps,
    apyPercent: row.rate_bps / 100,
    penaltyBps: row.penalty_bps,
    minDepositCents: Number(row.min_deposit_cents),
  };
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function explorerUrlFor(txHash: string): string {
  return `https://preview.cardanoscan.io/transaction/${txHash}`;
}

/** Number of samples in the payout curve (inclusive of both endpoints). */
const CURVE_SAMPLES = 121;

function buildCurve(
  principal: bigint,
  rateBps: bigint,
  start: bigint,
  maturity: bigint,
  penaltyBps: bigint,
): CurvePoint[] {
  const points: CurvePoint[] = [];
  const span = maturity - start;
  for (let i = 0; i < CURVE_SAMPLES; i++) {
    const t = start + (span * BigInt(i)) / BigInt(CURVE_SAMPLES - 1);
    points.push({
      tMs: Number(t),
      accruedCents: lovelaceToCents(accrued(principal, rateBps, start, maturity, t)),
      penaltyCents: lovelaceToCents(penaltyFee(principal, rateBps, start, maturity, penaltyBps, t)),
      earlyPayoutCents: lovelaceToCents(earlyPayout(principal, rateBps, start, maturity, penaltyBps, t)),
    });
  }
  return points;
}

/** Derive the member-facing CD DTO from a joined transaction row. */
export function toCdDto(row: CdRow, nowMs: number): CdDto {
  const product = productDtoFromRow(row);
  const principalCents = Number(row.amount_cents);
  const createdAtMs = row.created_at.getTime();

  const signed = (row.payload ?? null) as SignedAttestationLike | null;
  const payload = signed?.payload;
  const attStart = asFiniteNumber(payload?.start);
  const attMaturity = asFiniteNumber(payload?.maturity);
  const attPrincipal = asFiniteNumber(payload?.principal);
  const attested = row.deposit_id !== null && attStart !== null && attMaturity !== null;

  // Effective terms: the signed attestation payload when attested, else the
  // product terms with the deposit time as a provisional start.
  const rateBps = (attested ? asFiniteNumber(payload?.rate_bps) : null) ?? row.rate_bps;
  const penaltyBps = (attested ? asFiniteNumber(payload?.penalty_bps) : null) ?? row.penalty_bps;
  const startMs = attested ? attStart! : createdAtMs;
  const maturityMs = attested
    ? attMaturity!
    : createdAtMs + row.term_months * ESTIMATED_MS_PER_MONTH;

  const status: CdStatus = !attested ? "pending" : nowMs < maturityMs ? "active" : "matured";

  // bigint terms for txlib (lovelace / epoch ms).
  const principal =
    attested && attPrincipal !== null
      ? BigInt(Math.trunc(attPrincipal))
      : centsToLovelace(BigInt(principalCents));
  const rate = BigInt(rateBps);
  const penalty = BigInt(penaltyBps);
  const start = BigInt(startMs);
  const maturity = BigInt(maturityMs);
  const now = BigInt(Math.max(nowMs, startMs));

  const accruedToday = accrued(principal, rate, start, maturity, now);
  const txHash = asString(signed?.tx_hash) ?? asString(payload?.tx_hash);

  return {
    transactionId: row.id,
    depositId: row.deposit_id,
    status,
    principalCents,
    product,
    memo: row.memo,
    createdAt: row.created_at.toISOString(),
    startMs: attested ? startMs : null,
    maturityMs: attested ? maturityMs : null,
    rateBps,
    penaltyBps,
    txHash,
    explorerUrl: txHash ? explorerUrlFor(txHash) : null,
    projectionEstimated: !attested,
    accruedTodayCents: lovelaceToCents(accruedToday),
    valueTodayCents: lovelaceToCents(principal + accruedToday),
    earlyPayoutTodayCents: lovelaceToCents(
      earlyPayout(principal, rate, start, maturity, penalty, now),
    ),
    maturityValueCents: lovelaceToCents(maturePayout(principal, rate, start, maturity)),
    curve: attested ? buildCurve(principal, rate, start, maturity, penalty) : null,
  };
}
