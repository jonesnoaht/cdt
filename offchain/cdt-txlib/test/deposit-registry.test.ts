/**
 * @cdt/txlib deposit registry co-spend plan unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  planRegistryAppend,
  planRegistryMintCospend,
  encodeDepositRegistryDatum,
  decodeDepositRegistryDatum,
  onchainRegistryRequired,
} from "../src/index.js";

const ADMIN = "11".repeat(28);

describe("planRegistryAppend", () => {
  it("appends fresh id", () => {
    expect(planRegistryAppend(["aa"], "bb")).toEqual(["aa", "bb"]);
  });
  it("rejects duplicate", () => {
    expect(() => planRegistryAppend(["aa"], "aa")).toThrow(/already registered/);
  });
});

describe("planRegistryMintCospend", () => {
  it("returns redeemer + next datum", () => {
    const plan = planRegistryMintCospend({
      adminVkhHex: ADMIN,
      usedDepositIdsHex: [],
      depositIdHex: Buffer.from("6", "utf8").toString("hex"),
    });
    expect(plan.nextUsedDepositIdsHex).toHaveLength(1);
    expect(plan.redeemer.length).toBeGreaterThan(2);
    expect(plan.nextDatum.length).toBeGreaterThan(2);
    const decoded = decodeDepositRegistryDatum(plan.nextDatum);
    expect(decoded.adminVkhHex).toBe(ADMIN);
  });

  it("round-trips empty used datum", () => {
    const enc = encodeDepositRegistryDatum({
      adminVkhHex: ADMIN,
      usedDepositIdsHex: [],
    });
    const d = decodeDepositRegistryDatum(enc);
    expect(d.usedDepositIdsHex).toEqual([]);
  });
});

describe("onchainRegistryRequired", () => {
  it("reads env", () => {
    expect(onchainRegistryRequired({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      onchainRegistryRequired({ ONCHAIN_REGISTRY_REQUIRED: "1" } as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});
