/**
 * Bank-account enrollment + VC verification for the oracle watcher.
 *
 * When CDT_VC_MODE=credentials, the CLI enrolls every `accounts.did` with a
 * full NCUA → CU → member chain using @cdt/credentials (same ceremony as the
 * issuance pipeline). Presentations are challenge-bound at verify time —
 * no accept-all, no file dump required for the lab path.
 *
 * Production: replace with IdentusAgent (HttpIdentusAgent) that resolves
 * wallet presentations from the member, not server-held holder keys.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";
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
} from "../../../credentials/src/index.js";
import type {
  PendingDeposit,
  VerifyPresentationHook,
  VerifyPresentationResult,
} from "./watcher.js";
import type { VcMode } from "./credentials-hook.js";
interface EnrolledMember {
  holder: Holder;
  credential: VerifiableCredential;
}

/**
 * In-process credential directory keyed by bank DID (`accounts.did`).
 * Mirrors pipeline CredentialDirectory so oracle + pipeline stay aligned.
 */
export class BankCredentialDirectory {
  readonly ncua: Issuer;
  readonly creditUnion: Issuer;
  readonly institutionCredential: VerifiableCredential;
  private readonly members = new Map<string, EnrolledMember>();

  constructor(creditUnionName = "CampusUSA Credit Union") {
    this.ncua = createIssuer("NCUA");
    this.creditUnion = createIssuer(creditUnionName);
    this.institutionCredential = issueCredential(
      this.ncua,
      this.creditUnion.did,
      INSURED_INSTITUTION_CREDENTIAL,
      { institutionName: creditUnionName, insuranceFund: "NCUSIF" },
    );
  }

  enroll(bankDid: string, memberName: string): void {
    if (this.members.has(bankDid)) return;
    const holder = createHolder();
    const credential = issueCredential(
      this.creditUnion,
      holder.did,
      ACCOUNT_HOLDER_CREDENTIAL,
      { bankDid, memberName, accountStanding: "good" },
    );
    this.members.set(bankDid, { holder, credential });
  }

  async enrollFromAccounts(pool: pg.Pool): Promise<number> {
    const { rows } = await pool.query(
      "SELECT DISTINCT did, member_name FROM accounts WHERE did IS NOT NULL AND did <> ''",
    );
    const before = this.members.size;
    for (const row of rows) {
      this.enroll(String(row.did), String(row.member_name));
    }
    return this.members.size - before;
  }

  isEnrolled(bankDid: string): boolean {
    return this.members.has(bankDid);
  }

  size(): number {
    return this.members.size;
  }

  trustedRootDid(): string {
    return this.ncua.did;
  }

  verifyHook(): VerifyPresentationHook {
    return (memberDid: string, _deposit: PendingDeposit): VerifyPresentationResult => {
      const member = this.members.get(memberDid);
      if (!member) {
        return {
          verified: false,
          error: `no credentials on file for ${memberDid} (enroll members or set CDT_ORACLE_ACCEPT_ALL_VC=1 for lab)`,
        };
      }
      const challenge = randomUUID();
      const presentation = createPresentation(
        member.holder,
        [this.institutionCredential, member.credential],
        { challenge },
      );
      const result = verifyPresentation(presentation, {
        trustedRoots: [this.ncua.did],
        challenge,
      });
      return result.ok
        ? { verified: true }
        : { verified: false, error: result.reason };
    };
  }
}

/**
 * Build the oracle verify hook for the active VC mode.
 * credentials mode requires a populated BankCredentialDirectory.
 */
export function verifyHookForMode(
  mode: VcMode,
  directory: BankCredentialDirectory | undefined,
  log?: (msg: string) => void,
): VerifyPresentationHook {
  const say = log ?? (() => undefined);
  if (mode === "accept_all") {
    return (memberDid) => {
      say(`oracle-watcher: DEMO MODE — accepting VC for ${memberDid}`);
      return { verified: true };
    };
  }
  if (mode === "credentials") {
    if (!directory) {
      return () => ({
        verified: false,
        error: "CDT_VC_MODE=credentials but no BankCredentialDirectory was provided",
      });
    }
    return directory.verifyHook();
  }
  return () => ({
    verified: false,
    error:
      "VC verification fail-closed. Set CDT_VC_MODE=credentials (enrolls bank DIDs) or CDT_ORACLE_ACCEPT_ALL_VC=1 for lab only.",
  });
}