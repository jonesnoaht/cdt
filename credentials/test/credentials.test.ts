import { describe, expect, it } from "vitest";
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
} from "../src/index.js";

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const CHALLENGE = "nonce-12345";

interface Chain {
  ncua: Issuer;
  campusUsa: Issuer;
  member: Holder;
  institutionCredential: VerifiableCredential;
  memberCredential: VerifiableCredential;
}

function buildChain(): Chain {
  const ncua = createIssuer("NCUA");
  const campusUsa = createIssuer("CampusUSA Credit Union");
  const member = createHolder();
  const institutionCredential = issueCredential(
    ncua,
    campusUsa.did,
    INSURED_INSTITUTION_CREDENTIAL,
    { charterNumber: "68589", insuranceFund: "NCUSIF" },
    { expiresInMs: YEAR_MS },
  );
  const memberCredential = issueCredential(
    campusUsa,
    member.did,
    ACCOUNT_HOLDER_CREDENTIAL,
    { name: "Alex Gator", memberSince: "2019-08-01", accountStanding: "good" },
    { expiresInMs: YEAR_MS },
  );
  return { ncua, campusUsa, member, institutionCredential, memberCredential };
}

describe("verifyPresentation", () => {
  it("accepts the full happy-path chain (NCUA -> CampusUSA -> member)", () => {
    const { ncua, member, institutionCredential, memberCredential } = buildChain();
    const presentation = createPresentation(
      member,
      [institutionCredential, memberCredential],
      { challenge: CHALLENGE },
    );
    expect(
      verifyPresentation(presentation, {
        trustedRoots: [ncua.did],
        challenge: CHALLENGE,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a tampered claim", () => {
    const { ncua, member, institutionCredential, memberCredential } = buildChain();
    const tampered: VerifiableCredential = {
      ...memberCredential,
      credentialSubject: {
        ...memberCredential.credentialSubject,
        accountStanding: "delinquent-but-edited-to-good",
      },
    };
    const presentation = createPresentation(
      member,
      [institutionCredential, tampered],
      { challenge: CHALLENGE },
    );
    const result = verifyPresentation(presentation, {
      trustedRoots: [ncua.did],
      challenge: CHALLENGE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/signature is invalid/);
  });

  it("rejects an expired credential", () => {
    const { ncua, campusUsa, member, institutionCredential } = buildChain();
    const expired = issueCredential(
      campusUsa,
      member.did,
      ACCOUNT_HOLDER_CREDENTIAL,
      { name: "Alex Gator" },
      { expiresInMs: -1000 },
    );
    const presentation = createPresentation(
      member,
      [institutionCredential, expired],
      { challenge: CHALLENGE },
    );
    const result = verifyPresentation(presentation, {
      trustedRoots: [ncua.did],
      challenge: CHALLENGE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/expired/);
  });

  it("rejects a credential whose issuer is not chained to a trusted root (self-issued)", () => {
    const { ncua, member, institutionCredential } = buildChain();
    // The member mints their own "credit union" issuer identity and
    // self-issues an account-holder credential.
    const rogueIssuer = createIssuer("Rogue member");
    const selfIssued = issueCredential(
      rogueIssuer,
      member.did,
      ACCOUNT_HOLDER_CREDENTIAL,
      { name: "Alex Gator", accountStanding: "good" },
      { expiresInMs: YEAR_MS },
    );
    const presentation = createPresentation(
      member,
      [institutionCredential, selfIssued],
      { challenge: CHALLENGE },
    );
    const result = verifyPresentation(presentation, {
      trustedRoots: [ncua.did],
      challenge: CHALLENGE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not a trusted root/);
  });

  it("rejects a presentation with the wrong challenge", () => {
    const { ncua, member, institutionCredential, memberCredential } = buildChain();
    const presentation = createPresentation(
      member,
      [institutionCredential, memberCredential],
      { challenge: "stale-replayed-nonce" },
    );
    const result = verifyPresentation(presentation, {
      trustedRoots: [ncua.did],
      challenge: CHALLENGE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/challenge/);
  });

  it("rejects a presentation signed by someone other than the credential subject", () => {
    const { ncua, institutionCredential, memberCredential } = buildChain();
    const thief = createHolder();
    const presentation = createPresentation(
      thief,
      [institutionCredential, memberCredential],
      { challenge: CHALLENGE },
    );
    const result = verifyPresentation(presentation, {
      trustedRoots: [ncua.did],
      challenge: CHALLENGE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/does not match the presentation holder/);
  });

  it("rejects a presentation whose holder field was swapped after signing", () => {
    const { ncua, member, institutionCredential, memberCredential } = buildChain();
    const impostor = createHolder();
    const genuine = createPresentation(
      member,
      [institutionCredential, memberCredential],
      { challenge: CHALLENGE },
    );
    const forged = { ...genuine, holder: impostor.did };
    const result = verifyPresentation(forged, {
      trustedRoots: [ncua.did],
      challenge: CHALLENGE,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty presentation", () => {
    const { ncua, member } = buildChain();
    const presentation = createPresentation(member, [], { challenge: CHALLENGE });
    const result = verifyPresentation(presentation, {
      trustedRoots: [ncua.did],
      challenge: CHALLENGE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no credentials/);
  });

  it("rejects when the institution credential is missing from the presentation", () => {
    const { ncua, member, memberCredential } = buildChain();
    const presentation = createPresentation(member, [memberCredential], {
      challenge: CHALLENGE,
    });
    const result = verifyPresentation(presentation, {
      trustedRoots: [ncua.did],
      challenge: CHALLENGE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not a trusted root/);
  });

  it("verifies a presentation after a JSON round-trip (wire format)", () => {
    const { ncua, member, institutionCredential, memberCredential } = buildChain();
    const presentation = createPresentation(
      member,
      [institutionCredential, memberCredential],
      { challenge: CHALLENGE },
    );
    const wire = JSON.parse(JSON.stringify(presentation));
    expect(
      verifyPresentation(wire, { trustedRoots: [ncua.did], challenge: CHALLENGE }),
    ).toEqual({ ok: true });
  });

  it("rejects a self-referential institution credential exempting itself from holder binding", () => {
    const { ncua, campusUsa, member, institutionCredential } = buildChain();
    // CampusUSA (validly attested by NCUA) issues an InsuredInstitutionCredential
    // to itself; a presentation of only chain credentials must not verify for
    // an arbitrary holder.
    const selfAttestation = issueCredential(
      campusUsa,
      campusUsa.did,
      INSURED_INSTITUTION_CREDENTIAL,
      { insuranceFund: "NCUSIF" },
      { expiresInMs: YEAR_MS },
    );
    const presentation = createPresentation(
      member,
      [institutionCredential, selfAttestation],
      { challenge: CHALLENGE },
    );
    const result = verifyPresentation(presentation, {
      trustedRoots: [ncua.did],
      challenge: CHALLENGE,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects verification when the expected challenge is missing at runtime", () => {
    const { ncua, member, institutionCredential, memberCredential } = buildChain();
    const presentation = createPresentation(
      member,
      [institutionCredential, memberCredential],
      { challenge: CHALLENGE },
    );
    // Simulate a plain-JS caller that forgets the challenge option.
    const result = verifyPresentation(presentation, {
      trustedRoots: [ncua.did],
    } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/challenge is required/);
  });

  it("rejects a proof whose purpose was altered", () => {
    const { ncua, member, institutionCredential, memberCredential } = buildChain();
    const altered: VerifiableCredential = {
      ...memberCredential,
      proof: { ...memberCredential.proof, proofPurpose: "authentication" },
    };
    const presentation = createPresentation(
      member,
      [institutionCredential, altered],
      { challenge: CHALLENGE },
    );
    const result = verifyPresentation(presentation, {
      trustedRoots: [ncua.did],
      challenge: CHALLENGE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/proof purpose/);
  });

  it("rejects when the root issuer is not trusted by the verifier", () => {
    const { member, institutionCredential, memberCredential } = buildChain();
    const otherRoot = createIssuer("Some other regulator");
    const presentation = createPresentation(
      member,
      [institutionCredential, memberCredential],
      { challenge: CHALLENGE },
    );
    const result = verifyPresentation(presentation, {
      trustedRoots: [otherRoot.did],
      challenge: CHALLENGE,
    });
    expect(result.ok).toBe(false);
  });
});
