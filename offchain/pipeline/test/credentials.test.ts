/** Unit tests for the boot credential ceremony / verify hook (no DB, no chain). */
import { describe, expect, it } from "vitest";
import { verifyPresentation } from "../../../credentials/src/index.ts";
import { CredentialDirectory } from "../src/credentials.js";

describe("CredentialDirectory", () => {
  it("verifies an enrolled member's NCUA -> credit-union -> member chain", async () => {
    const directory = new CredentialDirectory();
    directory.enroll("did:demo:ada", "Ada Lovelace");
    const hook = directory.verifyHook();
    const result = await hook("did:demo:ada", {} as never);
    expect(result).toEqual({ verified: true });
  });

  it("rejects members that were never enrolled", async () => {
    const directory = new CredentialDirectory();
    const hook = directory.verifyHook();
    const result = await hook("did:demo:mallory", {} as never);
    expect(result.verified).toBe(false);
    if (!result.verified) {
      expect(result.error).toContain("no credentials on file");
    }
  });

  it("binds presentations to the verifier's challenge", () => {
    const directory = new CredentialDirectory();
    directory.enroll("did:demo:ada", "Ada Lovelace");
    const presentation = directory.present("did:demo:ada", "challenge-A");
    expect(presentation).toBeDefined();
    // Verifying under a different challenge must fail (replay protection).
    const replay = verifyPresentation(presentation!, {
      trustedRoots: [directory.ncua.did],
      challenge: "challenge-B",
    });
    expect(replay.ok).toBe(false);
  });

  it("rejects a chain not rooted in the trusted NCUA", () => {
    const directory = new CredentialDirectory();
    const other = new CredentialDirectory();
    directory.enroll("did:demo:ada", "Ada Lovelace");
    const presentation = directory.present("did:demo:ada", "challenge");
    const result = verifyPresentation(presentation!, {
      trustedRoots: [other.ncua.did], // different root of trust
      challenge: "challenge",
    });
    expect(result.ok).toBe(false);
  });
});
