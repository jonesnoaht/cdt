import { describe, expect, it, vi } from "vitest";
import {
  reconcileSupply,
  tickBurns,
  tickMints,
  type FacilityWatcherDeps,
  type PaidUnburnedPresentment,
  type UnmintedFacility,
} from "../src/facility-watcher.js";

function makeDeps(
  overrides: Partial<FacilityWatcherDeps> = {},
): FacilityWatcherDeps {
  return {
    listPaidUnburned: async () => [],
    burnOnChain: async () => "tx_burn",
    markBurned: async () => {},
    listUnmintedFacilities: async () => [],
    mintOnChain: async () => "tx_mint",
    markMinted: async () => {},
    getChainSupply: async () => 0n,
    getFacilityLimit: async () => 0n,
    haltFacility: async () => {},
    ...overrides,
  };
}

describe("tickBurns", () => {
  it("burns and marks each paid unburned presentment", async () => {
    const due: PaidUnburnedPresentment[] = [
      { id: 1, amountCents: 100_00, seriesId: "series_a" },
      { id: 2, amountCents: 50_00, seriesId: "series_a" },
    ];
    const burnOnChain = vi.fn(async (p: PaidUnburnedPresentment) => `tx_${p.id}`);
    const markBurned = vi.fn(async () => {});
    const n = await tickBurns(
      makeDeps({
        listPaidUnburned: async () => due,
        burnOnChain,
        markBurned,
      }),
    );
    expect(n).toBe(2);
    expect(burnOnChain).toHaveBeenCalledTimes(2);
    expect(markBurned).toHaveBeenCalledWith(1, "tx_1");
    expect(markBurned).toHaveBeenCalledWith(2, "tx_2");
  });

  it("returns 0 when none due", async () => {
    const n = await tickBurns(makeDeps());
    expect(n).toBe(0);
  });
});

describe("tickMints", () => {
  it("mints full limit for unminted active facilities", async () => {
    const open: UnmintedFacility[] = [
      {
        facilityId: 10,
        seriesId: "series_x",
        limitCents: 900_00,
        maturityMs: Date.UTC(2027, 0, 1),
        depositorWallet: "addr_dep",
      },
    ];
    const mintOnChain = vi.fn(async () => "tx_mint_1");
    const markMinted = vi.fn(async () => {});
    const n = await tickMints(
      makeDeps({
        listUnmintedFacilities: async () => open,
        mintOnChain,
        markMinted,
      }),
    );
    expect(n).toBe(1);
    expect(mintOnChain).toHaveBeenCalledWith(open[0]);
    expect(markMinted).toHaveBeenCalledWith(10, "tx_mint_1");
  });
});

describe("reconcileSupply", () => {
  it("halts when chain supply exceeds limit", async () => {
    const haltFacility = vi.fn(async () => {});
    const result = await reconcileSupply(
      makeDeps({
        getChainSupply: async () => 1000n,
        getFacilityLimit: async () => 900n,
        haltFacility,
      }),
      42,
    );
    expect(result).toEqual({ halted: true, chainSupply: 1000n, limit: 900n });
    expect(haltFacility).toHaveBeenCalledWith(42, expect.stringMatching(/exceed/i));
  });

  it("does not halt when supply within limit", async () => {
    const haltFacility = vi.fn(async () => {});
    const result = await reconcileSupply(
      makeDeps({
        getChainSupply: async () => 900n,
        getFacilityLimit: async () => 900n,
        haltFacility,
      }),
      42,
    );
    expect(result.halted).toBe(false);
    expect(haltFacility).not.toHaveBeenCalled();
  });
});
