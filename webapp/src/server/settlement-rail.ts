/**
 * Settlement payment rail adapter.
 *
 * SettlementPayment is an audit record on the presentment row plus an optional
 * push to an external ACH/FedNow adapter.
 *
 * Modes (SETTLEMENT_RAIL):
 *   mock  — always succeeds with a synthetic trace id (lab default)
 *   log   — same as mock but logs to console
 *   http  — POST to SETTLEMENT_ACH_URL (real bank adapter / middleware)
 *   none  — refuse to pay (record-only until rail wired)
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

/**
 * HTTP ACH/FedNow adapter (middleware / core gateway).
 *
 * POST SETTLEMENT_ACH_URL
 *   Authorization: Bearer SETTLEMENT_ACH_TOKEN (optional)
 *   Body: SettlementRailRequest JSON
 *   2xx Body: { "traceId": "…", "paidAt"?: ISO, "rail"?: string }
 *   4xx/5xx or { "ok": false, "reason": "…" } → RAIL_REJECTED / RAIL_ERROR
 */
export class HttpAchRail implements SettlementRail {
  readonly name = "ACH-http";
  constructor(
    private readonly url: string,
    private readonly token?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async pay(
    req: SettlementRailRequest,
    nowMs: number,
  ): Promise<SettlementRailResult | SettlementRailError> {
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json",
      };
      if (this.token) headers.authorization = `Bearer ${this.token}`;
      const res = await this.fetchImpl(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...req,
          requestedAt: new Date(nowMs).toISOString(),
        }),
      });
      const text = await res.text();
      let body: {
        ok?: boolean;
        traceId?: string;
        paidAt?: string;
        rail?: string;
        reason?: string;
      } = {};
      try {
        body = text ? (JSON.parse(text) as typeof body) : {};
      } catch {
        if (!res.ok) {
          return {
            ok: false,
            reason: `ACH HTTP ${res.status}: ${text.slice(0, 200)}`,
            reasonCode: "RAIL_ERROR",
          };
        }
      }
      if (!res.ok || body.ok === false) {
        return {
          ok: false,
          reason: body.reason ?? `ACH HTTP ${res.status}: ${text.slice(0, 200)}`,
          reasonCode: res.status >= 500 ? "RAIL_ERROR" : "RAIL_REJECTED",
        };
      }
      if (!body.traceId || typeof body.traceId !== "string") {
        return {
          ok: false,
          reason: "ACH adapter response missing traceId.",
          reasonCode: "RAIL_ERROR",
        };
      }
      return {
        ok: true,
        rail: body.rail ?? this.name,
        traceId: body.traceId,
        paidAt: body.paidAt ?? new Date(nowMs).toISOString(),
        raw: body,
      };
    } catch (err) {
      return {
        ok: false,
        reason: `ACH adapter network error: ${String(err)}`,
        reasonCode: "RAIL_ERROR",
      };
    }
  }
}

export function settlementRailFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SettlementRail {
  const mode = (env.SETTLEMENT_RAIL || "mock").toLowerCase();
  if (mode === "none" || mode === "disabled") return new DisabledRail();
  if (mode === "log") return new LogAchRail();
  if (mode === "http" || mode === "ach") {
    const url = env.SETTLEMENT_ACH_URL || "";
    if (!url) {
      throw new Error(
        "SETTLEMENT_RAIL=http requires SETTLEMENT_ACH_URL (bank ACH/FedNow adapter endpoint)",
      );
    }
    return new HttpAchRail(url, env.SETTLEMENT_ACH_TOKEN);
  }
  return new MockAchRail();
}
