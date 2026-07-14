/**
 * DTO types shared between the API server and the front end.
 *
 * All money amounts are integer cents unless the field name says otherwise.
 * (The on-chain demo pegs 1 cent = 10,000 lovelace; the API converts back to
 * cents for display so members only ever see dollars.)
 */

export interface ProductDto {
  id: number;
  name: string;
  termMonths: number;
  rateBps: number;
  /**
   * Annual percentage yield, in percent (e.g. 4.5 for 450 bps). The CDT
   * vault pays simple (non-compounding) interest, so APY equals the APR
   * implied by rate_bps.
   */
  apyPercent: number;
  penaltyBps: number;
  minDepositCents: number;
}

export interface MemberDto {
  /** Smallest account id belonging to this member (stable demo login id). */
  id: number;
  memberName: string;
  walletAddress: string;
  did: string;
}

export interface AccountDto {
  id: number;
  memberName: string;
  walletAddress: string;
  did: string;
  kind: "checking" | "cd_funding";
  balanceCents: number;
  createdAt: string;
}

export type CdStatus = "pending" | "active" | "matured";

/** One sample of the early-withdrawal payout curve. */
export interface CurvePoint {
  /** Sample time, unix epoch ms (clamped into [start, maturity]). */
  tMs: number;
  accruedCents: number;
  penaltyCents: number;
  earlyPayoutCents: number;
}

export interface CdDto {
  /** Bank core transaction id of the CD-funding deposit. */
  transactionId: number;
  /** Oracle deposit id (null until the deposit is attested). */
  depositId: string | null;
  status: CdStatus;
  principalCents: number;
  product: ProductDto;
  memo: string | null;
  createdAt: string;
  /**
   * Certificate term from the signed attestation payload. Null while the
   * deposit is pending; the projections below then use the deposit time and
   * the product term as an estimate.
   */
  startMs: number | null;
  maturityMs: number | null;
  /** Effective rate/penalty (attestation payload when attested, else product). */
  rateBps: number;
  penaltyBps: number;
  /** On-chain mint transaction hash, when the pipeline has recorded one. */
  txHash: string | null;
  explorerUrl: string | null;
  /** True while projections are estimates (deposit not yet attested). */
  projectionEstimated: boolean;
  accruedTodayCents: number;
  /** principal + interest accrued to date. */
  valueTodayCents: number;
  /** What an early withdrawal today would pay (principal + accrued − penalty). */
  earlyPayoutTodayCents: number;
  /** What the certificate pays at maturity (principal + full interest). */
  maturityValueCents: number;
  /**
   * Early-withdrawal payout sampled across the term (ascending tMs), for the
   * accrual chart and the withdrawal calculator. Null while pending.
   */
  curve: CurvePoint[] | null;
}

export interface DepositRequest {
  productId: number;
  amountCents: number;
}

export interface DepositResponse {
  transactionId: number;
  accountId: number;
  productId: number;
  amountCents: number;
  status: "pending";
}

export interface ChainLookupDto {
  available: boolean;
  reason?: string;
  provider?: string;
  txHash?: string;
  explorerUrl?: string;
  /** Raw provider response for the transaction (shape depends on provider). */
  tx?: unknown;
}

export interface ApiError {
  error: string;
}
