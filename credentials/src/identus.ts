/**
 * Identus / Hyperledger adapter skeleton + HTTP client.
 *
 * Production identity path for CDT:
 *   mock did:key (today, @cdt/credentials) → Hyperledger Identus (did:prism)
 *
 * HttpIdentusAgent talks to a thin agent façade with these endpoints
 * (map them to your Identus cloud/agent when wiring production):
 *
 *   GET  {base}/health
 *        → { ready: boolean, detail?: string }
 *   POST {base}/v1/presentations/verify
 *        body: { presentation, challenge, trustedRoots }
 *        → { ok: true } | { ok: false, reason: string }
 *   POST {base}/v1/credentials/account-holder
 *        body: { memberDid, claims?, expiresInMs? }
 *        → { credentialId: string } | { error: string }
 *
 * MockIdentusAgent remains the lab path using @cdt/credentials.
 */
import {
  ACCOUNT_HOLDER_CREDENTIAL,
  INSURED_INSTITUTION_CREDENTIAL,
  createHolder,
  createIssuer,
  createPresentation,
  issueCredential,
  verifyPresentation,
  type Holder,
  type Issuer,
  type VerifiableCredential,
  type VerifiablePresentation,
  type VerifyResult,
} from "./vc.js";

/** Minimal agent surface CDT needs for mint gating and member onboarding. */
export interface IdentusAgent {
  readonly kind: "mock" | "http" | "unconfigured";
  /** Trusted root DID(s) used when verifying presentations (e.g. NCUA). */
  trustedRoots(): string[];
  /** Issue AccountHolderCredential after CIP at the CU (lab: mock crypto). */
  issueAccountHolder(input: {
    member: Holder;
    claims?: Record<string, unknown>;
    expiresInMs?: number;
  }): Promise<{ credential: VerifiableCredential } | { error: string }>;
  /** Verify a wallet presentation for mint-time challenge. */
  verifyPresentation(input: {
    presentation: VerifiablePresentation;
    challenge: string;
    now?: Date;
  }): Promise<VerifyResult>;
  /** Health / readiness for ops. */
  status(): Promise<{ ready: boolean; detail: string }>;
}

/**
 * Lab stand-in using @cdt/credentials. Not production Identus.
 */
export class MockIdentusAgent implements IdentusAgent {
  readonly kind = "mock" as const;
  private readonly root: Issuer;
  private readonly institution: Issuer;
  private institutionCredential: VerifiableCredential;

  constructor(opts?: { rootName?: string; institutionName?: string }) {
    this.root = createIssuer(opts?.rootName ?? "NCUA");
    this.institution = createIssuer(opts?.institutionName ?? "CampusUSA Credit Union");
    this.institutionCredential = issueCredential(
      this.root,
      this.institution.did,
      INSURED_INSTITUTION_CREDENTIAL,
      {
        institutionName: this.institution.name,
        insuranceFund: "NCUSIF",
      },
    );
  }

  trustedRoots(): string[] {
    return [this.root.did];
  }

  async issueAccountHolder(input: {
    member: Holder;
    claims?: Record<string, unknown>;
    expiresInMs?: number;
  }): Promise<{ credential: VerifiableCredential } | { error: string }> {
    const credential = issueCredential(
      this.institution,
      input.member.did,
      ACCOUNT_HOLDER_CREDENTIAL,
      {
        accountStanding: "good",
        ...(input.claims ?? {}),
      },
      input.expiresInMs !== undefined ? { expiresInMs: input.expiresInMs } : {},
    );
    return { credential };
  }

  async verifyPresentation(input: {
    presentation: VerifiablePresentation;
    challenge: string;
    now?: Date;
  }): Promise<VerifyResult> {
    return verifyPresentation(input.presentation, {
      trustedRoots: this.trustedRoots(),
      challenge: input.challenge,
      ...(input.now ? { now: input.now } : {}),
    });
  }

  async status(): Promise<{ ready: boolean; detail: string }> {
    return {
      ready: true,
      detail: `MockIdentusAgent ready (root=${this.root.did}, institution=${this.institution.did}). Replace with HttpIdentusAgent for production Identus.`,
    };
  }

  /** Lab helper: full NCUA → CU → member presentation. */
  labCreatePresentation(member: Holder, challenge: string): VerifiablePresentation {
    const memberCred = issueCredential(
      this.institution,
      member.did,
      ACCOUNT_HOLDER_CREDENTIAL,
      { accountStanding: "good" },
    );
    return createPresentation(
      member,
      [this.institutionCredential, memberCred],
      { challenge },
    );
  }

  labCreateHolder(): Holder {
    return createHolder();
  }
}

export interface HttpIdentusAgentOptions {
  baseUrl: string;
  apiToken?: string;
  trustedRoots?: string[];
  fetchImpl?: typeof fetch;
  /** Request timeout ms (default 15s). */
  timeoutMs?: number;
}

/**
 * HTTP client for an Identus agent façade.
 * Fail-closed on network/HTTP errors.
 */
export class HttpIdentusAgent implements IdentusAgent {
  readonly kind = "http" as const;
  private readonly baseUrl: string;
  private readonly apiToken?: string;
  private readonly roots: string[];
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: HttpIdentusAgentOptions | string, apiToken?: string, roots: string[] = []) {
    if (typeof opts === "string") {
      this.baseUrl = opts.replace(/\/$/, "");
      if (apiToken !== undefined) this.apiToken = apiToken;
      this.roots = roots;
      this.fetchImpl = fetch;
      this.timeoutMs = 15_000;
    } else {
      this.baseUrl = opts.baseUrl.replace(/\/$/, "");
      if (opts.apiToken !== undefined) this.apiToken = opts.apiToken;
      this.roots = opts.trustedRoots ?? [];
      this.fetchImpl = opts.fetchImpl ?? fetch;
      this.timeoutMs = opts.timeoutMs ?? 15_000;
    }
  }

  trustedRoots(): string[] {
    return this.roots;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (this.apiToken) h.authorization = `Bearer ${this.apiToken}`;
    return h;
  }

  async issueAccountHolder(input: {
    member: Holder;
    claims?: Record<string, unknown>;
    expiresInMs?: number;
  }): Promise<{ credential: VerifiableCredential } | { error: string }> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/credentials/account-holder`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          memberDid: input.member.did,
          claims: input.claims ?? {},
          expiresInMs: input.expiresInMs,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const body = (await res.json().catch(() => ({}))) as {
        credential?: VerifiableCredential;
        error?: string;
      };
      if (!res.ok) {
        return { error: body.error ?? `Identus agent HTTP ${res.status}` };
      }
      if (!body.credential) {
        return { error: "Identus agent returned no credential object." };
      }
      return { credential: body.credential };
    } catch (err) {
      return { error: `Identus issueAccountHolder failed: ${String(err)}` };
    }
  }

  async verifyPresentation(input: {
    presentation: VerifiablePresentation;
    challenge: string;
    now?: Date;
  }): Promise<VerifyResult> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/presentations/verify`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          presentation: input.presentation,
          challenge: input.challenge,
          trustedRoots: this.roots,
          now: input.now?.toISOString(),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
      };
      if (!res.ok) {
        return { ok: false, reason: body.reason ?? `Identus agent HTTP ${res.status}` };
      }
      if (body.ok === true) return { ok: true };
      return { ok: false, reason: body.reason ?? "presentation rejected by Identus agent" };
    } catch (err) {
      return { ok: false, reason: `Identus verifyPresentation failed: ${String(err)}` };
    }
  }

  async status(): Promise<{ ready: boolean; detail: string }> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/health`, {
        method: "GET",
        headers: this.headers(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        return {
          ready: false,
          detail: `Identus agent health HTTP ${res.status} (baseUrl=${this.baseUrl})`,
        };
      }
      const body = (await res.json().catch(() => ({}))) as {
        ready?: boolean;
        detail?: string;
      };
      return {
        ready: body.ready === true,
        detail:
          body.detail ??
          `Identus agent reachable at ${this.baseUrl}; token=${this.apiToken ? "set" : "unset"}`,
      };
    } catch (err) {
      return {
        ready: false,
        detail: `Identus agent unreachable at ${this.baseUrl}: ${String(err)}`,
      };
    }
  }
}

export class UnconfiguredIdentusAgent implements IdentusAgent {
  readonly kind = "unconfigured" as const;
  trustedRoots(): string[] {
    return [];
  }
  async issueAccountHolder(): Promise<{ error: string }> {
    return { error: "Identus agent unconfigured (set IDENTUS_MODE=mock|http)." };
  }
  async verifyPresentation(): Promise<VerifyResult> {
    return { ok: false, reason: "Identus agent unconfigured." };
  }
  async status(): Promise<{ ready: boolean; detail: string }> {
    return {
      ready: false,
      detail: "Set IDENTUS_MODE=mock for lab or IDENTUS_MODE=http + IDENTUS_BASE_URL for production agent.",
    };
  }
}

export function createIdentusAgentFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): IdentusAgent {
  const mode = (env.IDENTUS_MODE || "unconfigured").toLowerCase();
  if (mode === "mock") return new MockIdentusAgent();
  if (mode === "http") {
    const base = env.IDENTUS_BASE_URL;
    if (!base) return new UnconfiguredIdentusAgent();
    const roots = (env.IDENTUS_TRUSTED_ROOTS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const opts: HttpIdentusAgentOptions = {
      baseUrl: base,
      trustedRoots: roots,
    };
    if (env.IDENTUS_API_TOKEN) opts.apiToken = env.IDENTUS_API_TOKEN;
    if (fetchImpl) opts.fetchImpl = fetchImpl;
    return new HttpIdentusAgent(opts);
  }
  return new UnconfiguredIdentusAgent();
}

export { ACCOUNT_HOLDER_CREDENTIAL, INSURED_INSTITUTION_CREDENTIAL };
