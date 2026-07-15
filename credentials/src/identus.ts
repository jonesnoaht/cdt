/**
 * Identus / Hyperledger adapter skeleton.
 *
 * Production identity path for CDT:
 *   mock did:key (today, @cdt/credentials) → Hyperledger Identus (did:prism)
 *
 * This module defines the **stable interface** the oracle / desk will call.
 * Implementations:
 *   - `MockIdentusAgent` — wraps @cdt/credentials (dev/lab)
 *   - `HttpIdentusAgent` — placeholder for a real agent HTTP API (fail-closed)
 *
 * Wire to the org's Identus deployment when mediator URL, DIDs, and trust
 * anchors are available — do not invent protocol details here.
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

/**
 * Placeholder for a real Identus cloud/agent HTTP API.
 * Fail-closed until implemented against the org's agent.
 */
export class HttpIdentusAgent implements IdentusAgent {
  readonly kind = "http" as const;
  constructor(
    private readonly baseUrl: string,
    private readonly apiToken?: string,
    private readonly roots: string[] = [],
  ) {}

  trustedRoots(): string[] {
    return this.roots;
  }

  async issueAccountHolder(): Promise<{ error: string }> {
    return {
      error: `HttpIdentusAgent not implemented (baseUrl=${this.baseUrl}). Wire to org Identus REST when available.`,
    };
  }

  async verifyPresentation(): Promise<VerifyResult> {
    return {
      ok: false,
      reason: `HttpIdentusAgent not implemented (baseUrl=${this.baseUrl}).`,
    };
  }

  async status(): Promise<{ ready: boolean; detail: string }> {
    return {
      ready: false,
      detail: `HttpIdentusAgent stub — IDENTUS_BASE_URL=${this.baseUrl}; token=${this.apiToken ? "set" : "unset"}.`,
    };
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
    return new HttpIdentusAgent(base, env.IDENTUS_API_TOKEN, roots);
  }
  return new UnconfiguredIdentusAgent();
}

export { ACCOUNT_HOLDER_CREDENTIAL, INSURED_INSTITUTION_CREDENTIAL };
