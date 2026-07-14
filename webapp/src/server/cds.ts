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
     AND a.kind = 'cd_funding'
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

/**
 * Parse a payload field as a non-negative integer (truncating any fractional
 * part), so a malformed attestation can never make a later BigInt()
 * conversion or txlib's non-negativity assertions throw.
 */
function asFiniteInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const truncated = Math.trunc(value);
  return truncated >= 0 ? truncated : null;
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
  const principalCents = lovelaceToCents(principal);
  for (let i = 0; i < CURVE_SAMPLES; i++) {
    const t = start + (span * BigInt(i)) / BigInt(CURVE_SAMPLES - 1);
    const accruedCents = lovelaceToCents(accrued(principal, rateBps, start, maturity, t));
    const earlyPayoutCents = lovelaceToCents(
      earlyPayout(principal, rateBps, start, maturity, penaltyBps, t),
    );
    points.push({
      tMs: Number(t),
      accruedCents,
      // Derived (rather than independently floored via penaltyFee) so the
      // displayed itemization always satisfies
      //   principal + accrued − penalty === earlyPayout
      // to the cent.
      penaltyCents: principalCents + accruedCents - earlyPayoutCents,
      earlyPayoutCents,
    });
  }
  return points;
}

/**
 * Derive the member-facing CD DTO from a joined transaction row.
 *
 * The payout curve is relatively large (121 samples) and only the detail
 * view needs it, so it is computed only when `includeCurve` is set.
 */
export function toCdDto(row: CdRow, nowMs: number, includeCurve = false): CdDto {
  const product = productDtoFromRow(row);
  const principalCents = Number(row.amount_cents);
  const createdAtMs = row.created_at.getTime();

  const signed = (row.payload ?? null) as SignedAttestationLike | null;
  const payload = signed?.payload;
  const attStart = asFiniteInteger(payload?.start);
  const attMaturity = asFiniteInteger(payload?.maturity);
  const attPrincipal = asFiniteInteger(payload?.principal);
  const attested =
    row.deposit_id !== null && attStart !== null && attMaturity !== null && attMaturity >= attStart;

  // Effective terms: the signed attestation payload when attested, else the
  // product terms with the deposit time as a provisional start. Clamps keep
  // txlib's non-negativity / maturity >= start assertions unreachable even
  // for misconfigured product rows.
  const rateBps = (attested ? asFiniteInteger(payload?.rate_bps) : null) ?? Math.max(0, row.rate_bps);
  const penaltyBps =
    (attested ? asFiniteInteger(payload?.penalty_bps) : null) ?? Math.max(0, row.penalty_bps);
  const startMs = attested ? attStart! : createdAtMs;
  const maturityMs = attested
    ? attMaturity!
    : createdAtMs + Math.max(0, row.term_months) * ESTIMATED_MS_PER_MONTH;

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
    curve: attested && includeCurve ? buildCurve(principal, rate, start, maturity, penalty) : null,
  };
}
