/**
 * CIP-30 pure helper unit tests (no browser).
 */
import { describe, expect, it } from "vitest";
import {
  CIP30_PREFERENCE,
  detectCip30Wallets,
  findLace,
  normalizeCborHex,
  signTxWithCip30,
  type Cip30WalletPlugin,
} from "../src/ui/cip30.js";

function mockPlugin(name: string, witness = "aabb"): Cip30WalletPlugin {
  return {
    name,
    enable: async () => ({
      getNetworkId: async () => 0,
      getUsedAddresses: async () => [],
      getUnusedAddresses: async () => [],
      getChangeAddress: async () => "addr_test1_mock",
      getRewardAddresses: async () => [],
      getUtxos: async () => [],
      getBalance: async () => "0",
      signTx: async () => witness,
      signData: async () => ({ signature: "00", key: "00" }),
      submitTx: async () => "00".repeat(32),
    }),
    isEnabled: async () => false,
  };
}

describe("detectCip30Wallets", () => {
  it("prefers Lace first", () => {
    const cardano = {
      nami: mockPlugin("Nami"),
      lace: mockPlugin("Lace"),
      eternl: mockPlugin("Eternl"),
    };
    const list = detectCip30Wallets(cardano);
    expect(list[0]?.id).toBe("lace");
    expect(findLace(cardano)?.id).toBe("lace");
    expect(CIP30_PREFERENCE[0]).toBe("lace");
  });

  it("returns empty when no injection", () => {
    expect(detectCip30Wallets(undefined)).toEqual([]);
    expect(detectCip30Wallets({})).toEqual([]);
  });
});

describe("normalizeCborHex", () => {
  it("strips 0x and lowercases", () => {
    expect(normalizeCborHex("0xAAbb")).toBe("aabb");
  });
  it("rejects odd length", () => {
    expect(() => normalizeCborHex("abc")).toThrow(/even-length/);
  });
});

describe("signTxWithCip30", () => {
  it("signs with Lace when present", async () => {
    const cardano = {
      nami: mockPlugin("Nami", "1111"),
      lace: mockPlugin("Lace", "deadbeef"),
    };
    const r = await signTxWithCip30({
      cborHex: "84a400",
      cardano,
      partialSign: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.walletId).toBe("lace");
      expect(r.witnessCborHex).toBe("deadbeef");
      expect(r.networkId).toBe(0);
    }
  });

  it("errors when no wallet", async () => {
    const r = await signTxWithCip30({ cborHex: "84a400", cardano: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NO_WALLET");
  });
});
