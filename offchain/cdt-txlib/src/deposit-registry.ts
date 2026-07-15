/**
 * Off-chain helpers for the on-chain one-shot deposit registry.
 *
 * The Aiken validator (parameterized by cdt_policy) requires:
 *   - admin co-sign
 *   - deposit_id not already in used
 *   - same tx mints exactly +1 of deposit_id under cdt_policy
 *
 * Output continuity (registry UTxO returns with next_datum) is enforced by
 * the transaction builder when wiring spend+payTo.
 */
import { Data } from "@lucid-evolution/lucid";
import {
  DepositRegistryDatum,
  DepositRegistryDatumSchema,
  DepositRegistryRedeemer,
  DepositRegistryRedeemerSchema,
} from "./types.js";
import { assertHexBytes } from "./blueprint.js";

export function encodeDepositRegistryDatum(d: {
  adminVkhHex: string;
  usedDepositIdsHex: string[];
}): string {
  const admin = assertHexBytes("adminVkhHex", d.adminVkhHex);
  if (admin.length !== 56) {
    throw new Error(`admin VKH must be 28 bytes (56 hex), got ${admin.length / 2}`);
  }
  const used = d.usedDepositIdsHex.map((id, i) =>
    assertHexBytes(`usedDepositIdsHex[${i}]`, id),
  );
  const datum: DepositRegistryDatum = {
    admin,
    used,
  };
  return Data.to(datum, DepositRegistryDatum);
}

export function decodeDepositRegistryDatum(plutusData: string): {
  adminVkhHex: string;
  usedDepositIdsHex: string[];
} {
  const d = Data.from(plutusData, DepositRegistryDatum) as DepositRegistryDatum;
  return {
    adminVkhHex: d.admin,
    usedDepositIdsHex: [...d.used],
  };
}

export function encodeRegisterDepositRedeemer(depositIdHex: string): string {
  const deposit_id = assertHexBytes("depositIdHex", depositIdHex);
  if (deposit_id.length === 0) throw new Error("deposit_id empty");
  const redeemer: DepositRegistryRedeemer = {
    RegisterDeposit: { deposit_id },
  };
  return Data.to(redeemer, DepositRegistryRedeemer);
}

/**
 * Pure plan for mint co-spend: given current used list + new deposit id,
 * return next used list or throw if already registered / empty.
 */
export function planRegistryAppend(
  usedDepositIdsHex: string[],
  newDepositIdHex: string,
): string[] {
  const id = assertHexBytes("newDepositIdHex", newDepositIdHex).toLowerCase();
  if (id.length === 0) throw new Error("deposit_id empty");
  const used = usedDepositIdsHex.map((u) =>
    assertHexBytes("used", u).toLowerCase(),
  );
  if (used.includes(id)) {
    throw new Error(`deposit_id already registered on-chain: ${id}`);
  }
  return [...used, id];
}

export interface RegistryMintCospendPlan {
  /** Redeemer CBOR hex for spending the registry UTxO. */
  redeemer: string;
  /** Next inline datum CBOR hex for the continuing registry UTxO. */
  nextDatum: string;
  /** Next used set (hex). */
  nextUsedDepositIdsHex: string[];
  adminVkhHex: string;
  depositIdHex: string;
}

/**
 * Build redeemer + next datum for a RegisterDeposit co-spend in a mint tx.
 */
export function planRegistryMintCospend(input: {
  adminVkhHex: string;
  usedDepositIdsHex: string[];
  /** UTF-8 deposit id as hex (asset name encoding), or raw hex id. */
  depositIdHex: string;
}): RegistryMintCospendPlan {
  const nextUsed = planRegistryAppend(input.usedDepositIdsHex, input.depositIdHex);
  return {
    redeemer: encodeRegisterDepositRedeemer(input.depositIdHex),
    nextDatum: encodeDepositRegistryDatum({
      adminVkhHex: input.adminVkhHex,
      usedDepositIdsHex: nextUsed,
    }),
    nextUsedDepositIdsHex: nextUsed,
    adminVkhHex: assertHexBytes("adminVkhHex", input.adminVkhHex),
    depositIdHex: assertHexBytes("depositIdHex", input.depositIdHex),
  };
}

/** Env gate: when true, pipeline must attach registry co-spend or refuse mint. */
export function onchainRegistryRequired(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.ONCHAIN_REGISTRY_REQUIRED === "1" ||
    env.ONCHAIN_REGISTRY_REQUIRED === "true"
  );
}
