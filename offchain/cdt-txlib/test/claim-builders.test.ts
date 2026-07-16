import { describe, expect, it } from "vitest";
import {
  assertClaimMintAmount,
  seriesIdToAssetNameHex,
} from "../src/claim-builders.js";

describe("assertClaimMintAmount", () => {
  it("accepts amount equal to limit", () => {
    expect(() => assertClaimMintAmount(900_00n, 900_00n)).not.toThrow();
  });

  it("rejects zero or negative amount", () => {
    expect(() => assertClaimMintAmount(0n, 900_00n)).toThrow(/positive/i);
    expect(() => assertClaimMintAmount(-1n, 900_00n)).toThrow(/positive/i);
  });

  it("rejects amount above limit", () => {
    expect(() => assertClaimMintAmount(901_00n, 900_00n)).toThrow(/limit/i);
  });
});

describe("seriesIdToAssetNameHex", () => {
  it("encodes series_id UTF-8 as hex", () => {
    // "ab" -> 6162
    expect(seriesIdToAssetNameHex("ab")).toBe("6162");
  });

  it("rejects empty series id", () => {
    expect(() => seriesIdToAssetNameHex("")).toThrow(/series/i);
  });
});
