/**
 * Mock Identus agent smoke test (lab path).
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MockIdentusAgent,
  createIdentusAgentFromEnv,
  UnconfiguredIdentusAgent,
} from "../src/identus.js";

describe("MockIdentusAgent", () => {
  it("issues member credential and verifies a presentation chain", async () => {
    const agent = new MockIdentusAgent();
    const member = agent.labCreateHolder();
    const issued = await agent.issueAccountHolder({
      member,
      claims: { name: "Ada Lovelace" },
    });
    expect("credential" in issued).toBe(true);

    const challenge = randomUUID();
    const presentation = agent.labCreatePresentation(member, challenge);
    const result = await agent.verifyPresentation({ presentation, challenge });
    expect(result).toEqual({ ok: true });

    const status = await agent.status();
    expect(status.ready).toBe(true);
  });

  it("rejects wrong challenge", async () => {
    const agent = new MockIdentusAgent();
    const member = agent.labCreateHolder();
    const presentation = agent.labCreatePresentation(member, "chal-a");
    const result = await agent.verifyPresentation({
      presentation,
      challenge: "chal-b",
    });
    expect(result.ok).toBe(false);
  });
});

describe("createIdentusAgentFromEnv", () => {
  it("defaults to unconfigured", () => {
    const agent = createIdentusAgentFromEnv({});
    expect(agent).toBeInstanceOf(UnconfiguredIdentusAgent);
  });

  it("selects mock mode", () => {
    const agent = createIdentusAgentFromEnv({ IDENTUS_MODE: "mock" });
    expect(agent.kind).toBe("mock");
  });
});
