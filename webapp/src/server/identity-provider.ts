/**
 * CIP / IDV / OFAC adapter — pluggable identity verification for bank desks.
 *
 * Real CIP stays at the credit union. This module is the *integration surface*
 * so desks can call a vendor (or core) instead of checkbox-only demo mode.
 *
 * Modes (CDT_IDV_MODE):
 *   mock     — lab: accepts when required fields present (default)
 *   http     — POST CDT_IDV_URL with walk-in payload
 *   disabled — always fail (force wire-up)
 *
 * Does not store NPI; returns only decision + opaque reference.
 */
export type IdvCheckKind = "cip" | "ofac" | "ownership" | "composite";

export interface IdvCheckRequest {
  kind: IdvCheckKind;
  /** Walk-in or member legal name (desk-entered). */
  subjectName: string;
  /** Optional core member id / account ref. */
  memberRef?: string;
  /** Holder DID from claim (if any). */
  holderDid?: string;
  /** Wallet address expected for possession checks. */
  walletAddress?: string;
  /** Presenting institution id. */
  institutionId?: string;
  /** Opaque desk session / presentment correlation. */
  correlationId?: string;
  /** True when desk claims OFAC clear (mock may require this). */
  ofacCleared?: boolean;
  /** True when desk claims CIP complete. */
  cipComplete?: boolean;
  /** True when ownership of CDT claim was evidenced. */
  ownershipVerified?: boolean;
}

export interface IdvCheckResult {
  ok: boolean;
  provider: string;
  /** Opaque vendor/core reference for audit (no NPI). */
  referenceId: string;
  checkedAt: string;
  reasons?: string[];
  raw?: unknown;
}

export interface IdentityProvider {
  readonly name: string;
  check(req: IdvCheckRequest, nowMs: number): Promise<IdvCheckResult>;
}

/** Lab provider: composite requires all three flags; single kinds check one flag. */
export class MockIdentityProvider implements IdentityProvider {
  readonly name = "idv-mock";
  async check(req: IdvCheckRequest, nowMs: number): Promise<IdvCheckResult> {
    const reasons: string[] = [];
    if (!req.subjectName?.trim()) reasons.push("subjectName required");

    if (req.kind === "cip" && !req.cipComplete) reasons.push("cipComplete required");
    if (req.kind === "ofac" && !req.ofacCleared) reasons.push("ofacCleared required");
    if (req.kind === "ownership" && !req.ownershipVerified) {
      reasons.push("ownershipVerified required");
    }
    if (req.kind === "composite") {
      if (!req.cipComplete) reasons.push("cipComplete required");
      if (!req.ofacCleared) reasons.push("ofacCleared required");
      if (!req.ownershipVerified) reasons.push("ownershipVerified required");
    }

    return {
      ok: reasons.length === 0,
      provider: this.name,
      referenceId: `MOCK-IDV-${nowMs.toString(36).toUpperCase()}`,
      checkedAt: new Date(nowMs).toISOString(),
      reasons: reasons.length ? reasons : undefined,
      raw: { simulated: true, kind: req.kind },
    };
  }
}

/**
 * HTTP CIP/OFAC/IDV gateway.
 *
 * POST CDT_IDV_URL
 *   Authorization: Bearer CDT_IDV_TOKEN (optional)
 *   Body: IdvCheckRequest
 *   2xx: { ok: boolean, referenceId: string, reasons?: string[] }
 */
export class HttpIdentityProvider implements IdentityProvider {
  readonly name = "idv-http";
  constructor(
    private readonly url: string,
    private readonly token?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async check(req: IdvCheckRequest, nowMs: number): Promise<IdvCheckResult> {
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json",
      };
      if (this.token) headers.authorization = `Bearer ${this.token}`;
      const res = await this.fetchImpl(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...req, requestedAt: new Date(nowMs).toISOString() }),
      });
      const text = await res.text();
      let body: {
        ok?: boolean;
        referenceId?: string;
        reasons?: string[];
      } = {};
      try {
        body = text ? (JSON.parse(text) as typeof body) : {};
      } catch {
        return {
          ok: false,
          provider: this.name,
          referenceId: "",
          checkedAt: new Date(nowMs).toISOString(),
          reasons: [`IDV HTTP ${res.status}: ${text.slice(0, 160)}`],
        };
      }
      if (!res.ok) {
        return {
          ok: false,
          provider: this.name,
          referenceId: body.referenceId ?? "",
          checkedAt: new Date(nowMs).toISOString(),
          reasons: body.reasons ?? [`IDV HTTP ${res.status}`],
          raw: body,
        };
      }
      return {
        ok: body.ok === true,
        provider: this.name,
        referenceId: body.referenceId ?? `HTTP-${nowMs}`,
        checkedAt: new Date(nowMs).toISOString(),
        reasons: body.reasons,
        raw: body,
      };
    } catch (err) {
      return {
        ok: false,
        provider: this.name,
        referenceId: "",
        checkedAt: new Date(nowMs).toISOString(),
        reasons: [`IDV network error: ${String(err)}`],
      };
    }
  }
}

export class DisabledIdentityProvider implements IdentityProvider {
  readonly name = "idv-disabled";
  async check(_req: IdvCheckRequest, nowMs: number): Promise<IdvCheckResult> {
    return {
      ok: false,
      provider: this.name,
      referenceId: "",
      checkedAt: new Date(nowMs).toISOString(),
      reasons: [
        "Identity provider disabled. Set CDT_IDV_MODE=mock (lab) or http with CDT_IDV_URL.",
      ],
    };
  }
}

export function identityProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): IdentityProvider {
  const mode = (env.CDT_IDV_MODE || "mock").toLowerCase();
  if (mode === "disabled" || mode === "none") return new DisabledIdentityProvider();
  if (mode === "http") {
    const url = env.CDT_IDV_URL || "";
    if (!url) {
      throw new Error("CDT_IDV_MODE=http requires CDT_IDV_URL");
    }
    return new HttpIdentityProvider(url, env.CDT_IDV_TOKEN);
  }
  return new MockIdentityProvider();
}
