/**
 * Wallet presentation challenge/complete tests.
 */
import { describe, expect, it } from "vitest";
import { MockIdentusAgent, WalletPresentationStore } from "../src/index.js";

describe("WalletPresentationStore", () => {
  it("issues challenge and verifies mock agent VP", async () => {
    const agent = new MockIdentusAgent();
    const store = new WalletPresentationStore(agent);
    const member = agent.labCreateHolder();
    const ch = store.issueChallenge({ memberDid: member.did });
    expect(ch.challengeId).toHaveLength(32);
    expect(ch.challenge).toHaveLength(64);

    const vp = agent.labCreatePresentation(member, ch.challenge);
    const result = await store.complete({
      challengeId: ch.challengeId,
      presentation: vp,
      memberDid: member.did,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects reuse", async () => {
    const agent = new MockIdentusAgent();
    const store = new WalletPresentationStore(agent);
    const member = agent.labCreateHolder();
    const ch = store.issueChallenge();
    const vp = agent.labCreatePresentation(member, ch.challenge);
    const first = await store.complete({
      challengeId: ch.challengeId,
      presentation: vp,
    });
    expect(first.ok).toBe(true);
    const second = await store.complete({
      challengeId: ch.challengeId,
      presentation: vp,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toMatch(/consumed/i);
  });

  it("rejects wrong challenge", async () => {
    const agent = new MockIdentusAgent();
    const store = new WalletPresentationStore(agent);
    const member = agent.labCreateHolder();
    const ch = store.issueChallenge();
    const vp = agent.labCreatePresentation(member, "wrong-challenge");
    const result = await store.complete({
      challengeId: ch.challengeId,
      presentation: vp,
    });
    expect(result.ok).toBe(false);
  });
});
