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
   * accrual chart and the withdrawal calculator. Null while pending, and
   * only populated when requested with `?curve=1` (the detail view).
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

/**
 * Bank-desk prep payload for the tokenization wizard: who the member is,
 * whether they have a CD funding account, and the compliance checklist the
 * teller must confirm before funding (demo stand-in for CIP / OFAC files).
 */
export interface TokenizePrepDto {
  member: MemberDto;
  accounts: AccountDto[];
  hasCdFunding: boolean;
  cdFundingAccountId: number | null;
  /** NCUSIF standard maximum share insurance amount, in cents. */
  insuranceLimitCents: number;
  checks: Array<{
    id: string;
    label: string;
    detail: string;
  }>;
  disclosures: Array<{
    id: string;
    text: string;
  }>;
  /** Suggested deposit amounts for the desk UI. */
  amountPresetsCents: number[];
}

/** Live pipeline stage for a single CD after the core deposit is booked. */
export type TokenizeStage =
  | "booked"
  | "awaiting_attestation"
  | "attested"
  | "tokenized"
  | "matured";

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

/** Foreign CDT claim as seen by a non-issuing (correspondent) credit union. */
export interface ClaimLookupDto {
  claim: CdDto;
  issuerName: string;
  holderName: string;
  holderDid: string;
  holderWallet: string;
  redeemable: boolean;
  cashOutMode: "mature" | "early" | "not_ready";
  cashOutCents: number | null;
  notes: string[];
}

export interface PresentmentChecks {
  cip: boolean;
  ofac: boolean;
  ownershipProof: boolean;
}

export interface PresentmentRequest {
  /** Deposit id or bank transaction id string. */
  claimRef: string;
  walkInName: string;
  presentingCuName?: string;
  checks: PresentmentChecks;
}

export type PresentmentStatus =
  | "pending_burn"
  | "cash_advanced_pending_settlement"
  | "settled"
  | "rejected";

export interface PresentmentDto {
  id: number;
  createdAt: string;
  status: PresentmentStatus;
  presentingCuName: string;
  issuerName: string;
  walkInName: string;
  transactionId: number;
  depositId: string | null;
  principalCents: number;
  cashOutCents: number;
  cashOutMode: "mature" | "early";
  productName: string;
  rateBps: number;
  holderDid: string;
  holderWallet: string;
  settlement: string;
  nextSteps: string[];
  /** Detailed burn-before-cash instructions (desk). */
  settlementInstructions?: string;
}

/**
 * Opt-in payment-terminal verification (freely spendable CDT paradigm).
 * Terminals call the oracle for a short-lived signed check; transfers stay
 * unconstrained on-chain.
 */
export interface PaymentChallengeDto {
  challenge: string;
  expiresAtMs: number;
}

export interface PaymentOraclePubKeyDto {
  algorithm: "Ed25519";
  publicKeySpkiBase64: string;
  purpose: string;
}

export interface PaymentVerifyRequest {
  /** Deposit id or bank transaction id. */
  claimRef: string;
  merchantId: string;
  /** Fresh challenge from POST /api/payment/challenge. */
  challenge: string;
  /** Optional invoice amount (cents); must not exceed principal if set. */
  amountCents?: number;
  /** Required: payer wallet must match attested owner (possession binding). */
  payerWallet: string;
}

export interface PaymentCheckPayload {
  schema: "cdt.payment_check.v1";
  /** Explicit: this check is advisory; assets remain freely transferable. */
  freelySpendable: true;
  depositId: string;
  transactionId: number;
  status: CdStatus;
  principalCents: number;
  rateBps: number;
  ownerWallet: string;
  ownerDid: string;
  holderName: string;
  issuerName: string;
  merchantId: string;
  amountCents: number | null;
  challenge: string;
  checkedAtMs: number;
  expiresAtMs: number;
  mintTxHash: string | null;
}

export interface SignedPaymentCheck {
  payload: PaymentCheckPayload;
  signature: string;
  algorithm: "Ed25519";
  oraclePublicKeySpkiBase64: string;
}

export type PaymentVerifyResponse =
  | {
      ok: true;
      signedCheck: SignedPaymentCheck;
      advice: string[];
    }
  | {
      ok: false;
      reason: string;
      claimSummary?: {
        transactionId: number;
        depositId: string | null;
        status: CdStatus;
        holderName: string;
      };
    };
