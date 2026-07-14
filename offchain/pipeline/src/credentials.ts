/**
 * Verifiable-credential ceremony for the pipeline (demo-grade).
 *
 * On service boot a full NCUA -> credit-union -> member trust chain is
 * created with `@cdt/credentials`:
 *
 * - a fresh NCUA root issuer and credit-union issuer are generated;
 * - the NCUA issues the credit union an `InsuredInstitutionCredential`;
 * - every member found in the bank's `accounts` table is enrolled: a holder
 *   keypair is generated and the credit union issues it an
 *   `AccountHolderCredential` carrying the bank DID (`accounts.did`) and
 *   member name as claims.
 *
 * The directory is keyed by the bank DID, so the oracle watcher's
 * `verifyPresentation` hook (which receives `accounts.did`) can ask the
 * enrolled holder for a fresh challenge-bound presentation and verify it
 * against the NCUA root. Deposits from DIDs that were never enrolled fail
 * verification and are never attested (and therefore never minted).
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
  type VerifiablePresentation,
} from "../../../credentials/src/index.ts";
import type { VerifyPresentationHook } from "../../oracle-watcher/src/index.ts";

interface EnrolledMember {
  holder: Holder;
  credential: VerifiableCredential;
}

export class CredentialDirectory {
  readonly ncua: Issuer;
  readonly creditUnion: Issuer;
  /** The NCUA's InsuredInstitutionCredential for the credit union. */
  readonly institutionCredential: VerifiableCredential;
  private readonly members = new Map<string, EnrolledMember>();

  constructor(creditUnionName = "Demo Federal Credit Union") {
    this.ncua = createIssuer("NCUA");
    this.creditUnion = createIssuer(creditUnionName);
    this.institutionCredential = issueCredential(
      this.ncua,
      this.creditUnion.did,
      INSURED_INSTITUTION_CREDENTIAL,
      { name: creditUnionName, insurer: "NCUA" },
    );
  }

  /** Enroll a bank member: generate holder keys and issue their credential. */
  enroll(bankDid: string, memberName: string): void {
    if (this.members.has(bankDid)) return;
    const holder = createHolder();
    const credential = issueCredential(
      this.creditUnion,
      holder.did,
      ACCOUNT_HOLDER_CREDENTIAL,
      { bankDid, memberName },
    );
    this.members.set(bankDid, { holder, credential });
  }

  /**
   * Enroll every member currently present in the bank's accounts table.
   * Returns the number of newly enrolled member DIDs.
   */
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

  /** Have the enrolled holder present their chain, bound to `challenge`. */
  present(
    bankDid: string,
    challenge: string,
  ): VerifiablePresentation | undefined {
    const member = this.members.get(bankDid);
    if (!member) return undefined;
    return createPresentation(
      member.holder,
      [this.institutionCredential, member.credential],
      { challenge },
    );
  }

  /**
   * The oracle watcher's `verifyPresentation` hook: request a fresh
   * challenge-bound presentation from the member and verify the whole
   * NCUA -> credit-union -> member chain.
   */
  verifyHook(): VerifyPresentationHook {
    return (memberDid) => {
      const challenge = randomUUID();
      const presentation = this.present(memberDid, challenge);
      if (!presentation) {
        return {
          verified: false,
          error: `no credentials on file for ${memberDid}`,
        };
      }
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
