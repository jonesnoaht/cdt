/**
 * Facility (credit-claim) watcher ticks: mint open facilities, burn paid
 * presentments, halt on supply > limit. Chain and DB I/O are injected for tests.
 */

export type PaidUnburnedPresentment = {
  id: number;
  amountCents: number;
  seriesId: string;
};

export type UnmintedFacility = {
  facilityId: number;
  seriesId: string;
  limitCents: number;
  maturityMs: number;
  depositorWallet: string;
};

export type FacilityWatcherDeps = {
  listPaidUnburned: () => Promise<PaidUnburnedPresentment[]>;
  burnOnChain: (p: PaidUnburnedPresentment) => Promise<string>;
  markBurned: (id: number, txHash: string) => Promise<void>;
  listUnmintedFacilities: () => Promise<UnmintedFacility[]>;
  mintOnChain: (f: UnmintedFacility) => Promise<string>;
  markMinted: (facilityId: number, txHash: string) => Promise<void>;
  getChainSupply: (facilityId: number) => Promise<bigint>;
  getFacilityLimit: (facilityId: number) => Promise<bigint>;
  haltFacility: (facilityId: number, reason: string) => Promise<void>;
};

/** Process paid presentments that still need an on-chain burn. */
export async function tickBurns(deps: FacilityWatcherDeps): Promise<number> {
  const due = await deps.listPaidUnburned();
  for (const p of due) {
    const txHash = await deps.burnOnChain(p);
    await deps.markBurned(p.id, txHash);
  }
  return due.length;
}

/** Mint CDT claim units for active facilities that have not been minted yet. */
export async function tickMints(deps: FacilityWatcherDeps): Promise<number> {
  const open = await deps.listUnmintedFacilities();
  for (const f of open) {
    const txHash = await deps.mintOnChain(f);
    await deps.markMinted(f.facilityId, txHash);
  }
  return open.length;
}

export type ReconcileResult = {
  halted: boolean;
  chainSupply: bigint;
  limit: bigint;
};

/** Halt facility minting when observed chain supply exceeds core limit. */
export async function reconcileSupply(
  deps: FacilityWatcherDeps,
  facilityId: number,
): Promise<ReconcileResult> {
  const chainSupply = await deps.getChainSupply(facilityId);
  const limit = await deps.getFacilityLimit(facilityId);
  if (chainSupply > limit) {
    await deps.haltFacility(
      facilityId,
      `chain supply ${chainSupply} exceeds facility limit ${limit}`,
    );
    return { halted: true, chainSupply, limit };
  }
  return { halted: false, chainSupply, limit };
}

/** One full watcher cycle: mints, burns, then optional reconcile for ids. */
export async function tickFacilityWatcher(
  deps: FacilityWatcherDeps,
  opts?: { reconcileFacilityIds?: number[] },
): Promise<{ minted: number; burned: number; halted: number }> {
  const minted = await tickMints(deps);
  const burned = await tickBurns(deps);
  let halted = 0;
  for (const id of opts?.reconcileFacilityIds ?? []) {
    const r = await reconcileSupply(deps, id);
    if (r.halted) halted += 1;
  }
  return { minted, burned, halted };
}
