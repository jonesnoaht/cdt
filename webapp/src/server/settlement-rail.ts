/**
 * Settlement payment rail adapter.
 *
 * SettlementPayment today is an audit record on the presentment row.
 * This module defines a pluggable rail so pilot ACH can be swapped in
 * without changing the desk API.
 *
 * Modes:
 *   mock  — always succeeds with a synthetic trace id (lab default)
 *   log   — same as mock but logs to console
 *   none  — refuse to pay (record-only / production until rail wired)
 */
export interface SettlementRailRequest {
  presentmentId: number;
  amountCents: number;
  currency: "USD";
  /** Presenting / redeeming CU settlement profile id or name. */
  beneficiaryRef: string;
  /** Issuer institution id. */
  originatorRef: string;
  depositId: string;
  memo?: string;
}

export interface SettlementRailResult {
  ok: true;
  rail: string;
  traceId: string;
  paidAt: string;
  raw?: unknown;
}

export interface SettlementRailError {
  ok: false;
  reason: string;
  reasonCode: "RAIL_DISABLED" | "RAIL_REJECTED" | "RAIL_ERROR";
}

export interface SettlementRail {
  readonly name: string;
  pay(
    req: SettlementRailRequest,
    nowMs: number,
  ): Promise<SettlementRailResult | SettlementRailError>;
}

/** Lab rail: always succeeds. */
export class MockAchRail implements SettlementRail {
  readonly name = "ACH-mock";
  async pay(
    req: SettlementRailRequest,
    nowMs: number,
  ): Promise<SettlementRailResult> {
    const traceId = `MOCK-ACH-${req.presentmentId}-${nowMs.toString(36).toUpperCase()}`;
    return {
      ok: true,
      rail: this.name,
      traceId,
      paidAt: new Date(nowMs).toISOString(),
      raw: { simulated: true, amountCents: req.amountCents },
    };
  }
}

export class LogAchRail implements SettlementRail {
  readonly name = "ACH-log";
  private readonly inner = new MockAchRail();
  async pay(
    req: SettlementRailRequest,
    nowMs: number,
  ): Promise<SettlementRailResult | SettlementRailError> {
    const result = await this.inner.pay(req, nowMs);
    console.log(
      `settlement-rail: ${this.name} pay presentment=${req.presentmentId} amount=${req.amountCents} → ${result.ok ? result.traceId : "FAIL"}`,
    );
    return { ...result, rail: this.name };
  }
}

/** Production placeholder until a real ACH/FedNow adapter is configured. */
export class DisabledRail implements SettlementRail {
  readonly name = "disabled";
  async pay(): Promise<SettlementRailError> {
    return {
      ok: false,
      reason:
        "Settlement rail disabled. Set SETTLEMENT_RAIL=mock for lab or wire a real ACH adapter.",
      reasonCode: "RAIL_DISABLED",
    };
  }
}

export function settlementRailFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SettlementRail {
  const mode = (env.SETTLEMENT_RAIL || "mock").toLowerCase();
  if (mode === "none" || mode === "disabled") return new DisabledRail();
  if (mode === "log") return new LogAchRail();
  return new MockAchRail();
}
