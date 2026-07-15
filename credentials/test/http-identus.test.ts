/**
 * HttpIdentusAgent client tests (mock fetch — no live Identus).
 */
import { describe, expect, it } from "vitest";
import {
  HttpIdentusAgent,
  createIdentusAgentFromEnv,
} from "../src/identus.js";
import type { VerifiablePresentation } from "../src/vc.js";

describe("HttpIdentusAgent", () => {
  it("reports ready from /health", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      expect(String(input)).toContain("/health");
      return new Response(JSON.stringify({ ready: true, detail: "ok" }), {
        status: 200,
      });
    };
    const agent = new HttpIdentusAgent({
      baseUrl: "https://identus.test",
      apiToken: "tok",
      trustedRoots: ["did:prism:root"],
      fetchImpl,
    });
    const status = await agent.status();
    expect(status.ready).toBe(true);
    expect(agent.trustedRoots()).toEqual(["did:prism:root"]);
  });

  it("verifies presentation via agent API", async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(String(input)).toContain("/v1/presentations/verify");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const agent = new HttpIdentusAgent({
      baseUrl: "https://identus.test",
      fetchImpl,
    });
    const result = await agent.verifyPresentation({
      presentation: { type: ["VerifiablePresentation"] } as VerifiablePresentation,
      challenge: "chal-1",
    });
    expect(result).toEqual({ ok: true });
  });

  it("fail-closed on network error", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const agent = new HttpIdentusAgent({
      baseUrl: "https://identus.test",
      fetchImpl,
    });
    const result = await agent.verifyPresentation({
      presentation: { type: ["VerifiablePresentation"] } as VerifiablePresentation,
      challenge: "x",
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toMatch(/ECONNREFUSED/);
  });

  it("createIdentusAgentFromEnv selects http", () => {
    const agent = createIdentusAgentFromEnv({
      IDENTUS_MODE: "http",
      IDENTUS_BASE_URL: "https://agent.example",
      IDENTUS_TRUSTED_ROOTS: "did:a,did:b",
    });
    expect(agent.kind).toBe("http");
    expect(agent.trustedRoots()).toEqual(["did:a", "did:b"]);
  });
});
