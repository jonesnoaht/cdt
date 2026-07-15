/**
 * Bank credential directory enrollment + verify (uses @cdt/credentials).
 */
import { describe, expect, it } from "vitest";
import { BankCredentialDirectory, verifyHookForMode } from "../src/bank-credentials.js";
import type { PendingDeposit } from "../src/watcher.js";

const fakeDeposit: PendingDeposit = {
  transactionId: 1,
  accountId: 1,
  amountCents: 100_000n,
  productId: 1,
  memberName: "Ada",
  walletAddress: "addr_test1qada",
  did: "did:bank:ada",
  product: {
    name: "12m",
    termMonths: 12,
    rateBps: 450,
    penaltyBps: 1000,
    minDepositCents: 50_000n,
  },
};

describe("BankCredentialDirectory", () => {
  it("enrolls and verifies a presentation chain", async () => {
    const dir = new BankCredentialDirectory();
    dir.enroll("did:bank:ada", "Ada Lovelace");
    expect(dir.isEnrolled("did:bank:ada")).toBe(true);
    const hook = dir.verifyHook();
    const result = await hook("did:bank:ada", fakeDeposit);
    expect(result).toEqual({ verified: true });
  });

  it("rejects unknown DIDs", async () => {
    const dir = new BankCredentialDirectory();
    const result = await dir.verifyHook()("did:unknown", fakeDeposit);
    expect(result.verified).toBe(false);
  });
});

describe("verifyHookForMode", () => {
  it("fail_closed rejects", async () => {
    const hook = verifyHookForMode("fail_closed", undefined);
    const r = await hook("did:x", fakeDeposit);
    expect(r.verified).toBe(false);
  });

  it("credentials requires directory", async () => {
    const hook = verifyHookForMode("credentials", undefined);
    const r = await hook("did:x", fakeDeposit);
    expect(r.verified).toBe(false);
  });

  it("accept_all accepts", async () => {
    const hook = verifyHookForMode("accept_all", undefined);
    const r = await hook("did:x", fakeDeposit);
    expect(r).toEqual({ verified: true });
  });
});
