/**
 * Runnable example of the full CDT credential ceremony:
 *
 *   1. NCUA (trusted root) attests that CampusUSA is a federally insured
 *      credit union (InsuredInstitutionCredential).
 *   2. CampusUSA attests a member's identity/KYC (AccountHolderCredential).
 *   3. The member presents both credentials to a verifier (e.g. the CDT
 *      minting service) against a verifier-supplied challenge.
 *   4. The verifier checks the whole chain back to the NCUA root.
 *
 * Run with: npm run example
 */

import { randomUUID } from "node:crypto";
import {
  ACCOUNT_HOLDER_CREDENTIAL,
  INSURED_INSTITUTION_CREDENTIAL,
  createHolder,
  createIssuer,
  createPresentation,
  issueCredential,
  verifyPresentation,
} from "./index.js";

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function heading(title: string): void {
  console.log(`\n=== ${title} ===`);
}

// 1. Actors
const ncua = createIssuer("NCUA");
const campusUsa = createIssuer("CampusUSA Credit Union");
const member = createHolder();

heading("Actors");
console.log(`NCUA (trusted root): ${ncua.did}`);
console.log(`CampusUSA:           ${campusUsa.did}`);
console.log(`Member:              ${member.did}`);

// 2. NCUA attests that CampusUSA is insured
const institutionCredential = issueCredential(
  ncua,
  campusUsa.did,
  INSURED_INSTITUTION_CREDENTIAL,
  {
    institutionName: "CampusUSA Credit Union",
    charterNumber: "68589",
    insuranceFund: "NCUSIF",
  },
  { expiresInMs: YEAR_MS },
);

heading("InsuredInstitutionCredential (NCUA -> CampusUSA)");
console.log(JSON.stringify(institutionCredential, null, 2));

// 3. CampusUSA attests the member's identity/KYC
const memberCredential = issueCredential(
  campusUsa,
  member.did,
  ACCOUNT_HOLDER_CREDENTIAL,
  {
    name: "Alex Gator",
    memberSince: "2019-08-01",
    accountStanding: "good",
  },
  { expiresInMs: YEAR_MS },
);

heading("AccountHolderCredential (CampusUSA -> member)");
console.log(JSON.stringify(memberCredential, null, 2));

// 4. Verifier hands the member a challenge; member builds a presentation
const challenge = randomUUID();
const presentation = createPresentation(
  member,
  [institutionCredential, memberCredential],
  { challenge },
);

heading("VerifiablePresentation (member -> verifier)");
console.log(JSON.stringify(presentation, null, 2));

// 5. Verifier checks the whole chain back to the NCUA root
const result = verifyPresentation(presentation, {
  trustedRoots: [ncua.did],
  challenge,
});

heading("Verification");
console.log(`challenge: ${challenge}`);
console.log(`result:    ${JSON.stringify(result)}`);

if (!result.ok) {
  process.exit(1);
}
console.log(
  "\nThe verifier now knows the member is a KYC'd account holder of an NCUA-insured credit union.",
);
