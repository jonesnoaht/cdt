/**
 * Wallet-held presentation sessions for mint-time challenges.
 *
 * Flow:
 *   1. POST challenge → { challengeId, challenge, expiresAt }
 *   2. Wallet builds VP bound to `challenge`
 *   3. POST complete with presentation → verified via IdentusAgent / @cdt/credentials
 *
 * Lab can still use PresentationDirectory file enrollment; this path is for
 * member wallets that hold AccountHolderCredential.
 */
import { randomBytes, createHash } from "node:crypto";
import {
  createIdentusAgentFromEnv,
  type IdentusAgent,
} from "./identus.js";
import {
  verifyPresentation,
  type VerifiablePresentation,
  type VerifyResult,
} from "./vc.js";

export interface PresentationChallenge {
  challengeId: string;
  challenge: string;
  memberDid?: string;
  expiresAt: string;
  createdAt: string;
}

export interface PresentationSessionComplete {
  challengeId: string;
  presentation: VerifiablePresentation;
  memberDid?: string;
}

export class WalletPresentationStore {
  private byId = new Map<
    string,
    PresentationChallenge & { consumed?: boolean }
  >();

  constructor(
    private readonly agent: IdentusAgent = createIdentusAgentFromEnv(),
    private readonly ttlMs = 10 * 60 * 1000,
  ) {}

  issueChallenge(opts?: {
    memberDid?: string;
    nowMs?: number;
    ttlMs?: number;
  }): PresentationChallenge {
    const now = opts?.nowMs ?? Date.now();
    const challengeId = randomBytes(16).toString("hex");
    const challenge = createHash("sha256")
      .update(`cdt.vp.challenge.v1:${challengeId}:${now}`)
      .digest("hex");
    const row: PresentationChallenge = {
      challengeId,
      challenge,
      expiresAt: new Date(now + (opts?.ttlMs ?? this.ttlMs)).toISOString(),
      createdAt: new Date(now).toISOString(),
    };
    if (opts?.memberDid) row.memberDid = opts.memberDid;
    this.byId.set(challengeId, row);
    return row;
  }

  get(challengeId: string): PresentationChallenge | undefined {
    return this.byId.get(challengeId);
  }

  async complete(
    input: PresentationSessionComplete,
    nowMs: number = Date.now(),
  ): Promise<VerifyResult & { challengeId: string }> {
    const row = this.byId.get(input.challengeId);
    if (!row) {
      return {
        ok: false,
        reason: "Unknown challengeId",
        challengeId: input.challengeId,
      };
    }
    if (row.consumed) {
      return {
        ok: false,
        reason: "Challenge already consumed",
        challengeId: input.challengeId,
      };
    }
    if (Date.parse(row.expiresAt) <= nowMs) {
      return {
        ok: false,
        reason: "Challenge expired",
        challengeId: input.challengeId,
      };
    }
    if (row.memberDid && input.memberDid && row.memberDid !== input.memberDid) {
      return {
        ok: false,
        reason: "memberDid does not match challenge binding",
        challengeId: input.challengeId,
      };
    }

    // Prefer Identus agent when http/mock; fall back to local verify with agent roots.
    const result = await this.agent.verifyPresentation({
      presentation: input.presentation,
      challenge: row.challenge,
      now: new Date(nowMs),
    });

    // If unconfigured agent, try local @cdt/credentials verify with empty roots → fail closed
    if (!result.ok && this.agent.kind === "unconfigured") {
      const local = verifyPresentation(input.presentation, {
        trustedRoots: [],
        challenge: row.challenge,
        now: new Date(nowMs),
      });
      return { ...local, challengeId: input.challengeId };
    }

    if (result.ok) {
      row.consumed = true;
    }
    return { ...result, challengeId: input.challengeId };
  }
}

export function walletPresentationStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): WalletPresentationStore {
  return new WalletPresentationStore(createIdentusAgentFromEnv(env));
}
