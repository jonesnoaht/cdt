/**
 * Helpers for CDT credit-claim mint/burn (no interest vault).
 * Full tx builders can extend this once the claim mint policy is blueprint-pinned.
 */

export type ClaimMintPlan = {
  seriesIdHex: string;
  amount: bigint;
  maturity: number;
  recipientBech32: string;
};

/** Ensure mint amount is positive and does not exceed facility limit. */
export function assertClaimMintAmount(amount: bigint, limit: bigint): void {
  if (amount <= 0n) {
    throw new Error(`mint amount must be positive, got ${amount}`);
  }
  if (amount > limit) {
    throw new Error(`mint amount ${amount} exceeds facility limit ${limit}`);
  }
}

/** UTF-8 series_id → asset name hex (no 0x prefix). */
export function seriesIdToAssetNameHex(seriesId: string): string {
  if (!seriesId || seriesId.length === 0) {
    throw new Error("series id required");
  }
  return Buffer.from(seriesId, "utf8").toString("hex");
}

export function planClaimMint(params: {
  seriesId: string;
  amount: bigint;
  limit: bigint;
  maturity: number;
  recipientBech32: string;
}): ClaimMintPlan {
  assertClaimMintAmount(params.amount, params.limit);
  if (params.maturity <= 0) {
    throw new Error("maturity must be positive");
  }
  return {
    seriesIdHex: seriesIdToAssetNameHex(params.seriesId),
    amount: params.amount,
    maturity: params.maturity,
    recipientBech32: params.recipientBech32,
  };
}
