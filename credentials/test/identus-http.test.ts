/**
 * HttpIdentusAgent path mapping + fail-closed network tests.
 */
import { describe, expect, it } from "vitest";
import { createHolder, HttpIdentusAgent, createIdentusAgentFromEnv } from "../src/index.js";

describe("HttpIdentusAgent", () => {
  it("uses custom path map", async () => {
    const seen: string[] = [];
    const agent = new HttpIdentusAgent({
      baseUrl: "https://identus.example",
      trustedRoots: ["did:prism:root"],
      paths: {
        health: "/ready",
        verifyPresentation: "/custom/verify",
        issueAccountHolder: "/custom/issue",
      },
      fetchImpl: async (url) => {
        seen.push(String(url));
        if (String(url).endsWith("/ready")) {
          return new Response(JSON.stringify({ status: "UP" }), { status: 200 });
        }
        if (String(url).includes("/custom/verify")) {
          return new Response(JSON.stringify({ verified: true }), { status: 200 });
        }
        if (String(url).includes("/custom/issue")) {
          return new Response(
            JSON.stringify({
              data: {
                credential: {
                  "@context": [],
                  type: ["VerifiableCredential"],
                  issuer: "did:x",
                  issuanceDate: new Date().toISOString(),
                  credentialSubject: { id: "did:y" },
                  proof: {
                    type: "Ed25519Signature2020",
                    created: new Date().toISOString(),
                    verificationMethod: "did:x#key",
                    proofPurpose: "assertionMethod",
                    proofValue: "x",
                  },
                },
              },
            }),
            { status: 200 },
          );
        }
        return new Response("nope", { status: 404 });
      },
    });

    const st = await agent.status();
    expect(st.ready).toBe(true);
    expect(seen.some((u) => u.endsWith("/ready"))).toBe(true);

    const v = await agent.verifyPresentation({
      presentation: {} as never,
      challenge: "c",
    });
    expect(v.ok).toBe(true);

    const member = createHolder();
    const issued = await agent.issueAccountHolder({ member });
    expect("credential" in issued).toBe(true);
  });

  it("fails closed on network error", async () => {
    const agent = new HttpIdentusAgent({
      baseUrl: "https://identus.example",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const v = await agent.verifyPresentation({
      presentation: {} as never,
      challenge: "c",
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/ECONNREFUSED|failed/i);
  });

  it("createIdentusAgentFromEnv maps path env", () => {
    const agent = createIdentusAgentFromEnv(
      {
        IDENTUS_MODE: "http",
        IDENTUS_BASE_URL: "https://x",
        IDENTUS_PATH_HEALTH: "/h",
      } as NodeJS.ProcessEnv,
      async (url) => {
        expect(String(url)).toBe("https://x/h");
        return new Response(JSON.stringify({ ready: true }), { status: 200 });
      },
    );
    expect(agent.kind).toBe("http");
  });
});
