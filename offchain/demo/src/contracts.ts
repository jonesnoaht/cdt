/**
 * Loads the vendored Aiken blueprint (onchain-vendored/plutus.json) and
 * exposes typed datum/redeemer schemas plus parameter application helpers.
 */

import { readFileSync } from "node:fs";

import {
  applyDoubleCborEncoding,
  applyParamsToScript,
  Data,
  mintingPolicyToId,
  validatorToAddress,
  validatorToScriptHash,
  type Network,
  type Script,
} from "@lucid-evolution/lucid";

// ---------------------------------------------------------------------------
// Blueprint
// ---------------------------------------------------------------------------

interface BlueprintValidator {
  title: string;
  compiledCode: string;
}

interface Blueprint {
  validators: BlueprintValidator[];
}

const blueprintUrl = new URL("../onchain-vendored/plutus.json", import.meta.url);

let cachedBlueprint: Blueprint | undefined;

export function loadBlueprint(): Blueprint {
  cachedBlueprint ??= JSON.parse(readFileSync(blueprintUrl, "utf8")) as Blueprint;
  return cachedBlueprint;
}

function findValidator(blueprint: Blueprint, title: string): BlueprintValidator {
  const validator = blueprint.validators.find((v) => v.title === title);
  if (!validator) {
    throw new Error(
      `validator ${title} not found in plutus.json — run \`aiken build\` in onchain-vendored/`,
    );
  }
  return validator;
}

// ---------------------------------------------------------------------------
// Datum / redeemer schemas (mirror lib/cdt/types.ak)
// ---------------------------------------------------------------------------

export const CDDatumSchema = Data.Object({
  owner: Data.Bytes(),
  issuer: Data.Bytes(),
  deposit_id: Data.Bytes(),
  principal: Data.Integer(),
  rate_bps: Data.Integer(),
  start: Data.Integer(),
  maturity: Data.Integer(),
  penalty_bps: Data.Integer(),
  cdt_policy: Data.Bytes(),
});
export type CDDatum = Data.Static<typeof CDDatumSchema>;
export const CDDatum = CDDatumSchema as unknown as CDDatum;

export const VaultRedeemerSchema = Data.Enum([
  Data.Literal("Redeem"),
  Data.Literal("EarlyWithdraw"),
]);
export type VaultRedeemer = Data.Static<typeof VaultRedeemerSchema>;
export const VaultRedeemer = VaultRedeemerSchema as unknown as VaultRedeemer;

export const MintRedeemerSchema = Data.Enum([
  Data.Object({ MintCD: Data.Object({ datum: CDDatumSchema }) }),
  Data.Literal("BurnCD"),
]);
export type MintRedeemer = Data.Static<typeof MintRedeemerSchema>;
export const MintRedeemer = MintRedeemerSchema as unknown as MintRedeemer;

// ---------------------------------------------------------------------------
// Script instantiation
// ---------------------------------------------------------------------------

export interface CdtContracts {
  vaultScript: Script;
  vaultHash: string;
  vaultAddress: string;
  mintScript: Script;
  policyId: string;
}

/**
 * Instantiate the vault and the (parameterized) minting policy.
 *
 * The vault compiles standalone; the policy takes the vault's script hash and
 * the oracle's key hash as parameters. The vault learns the policy id via its
 * datum, which the policy verifies at mint time — no circular dependency.
 */
export function instantiateContracts(
  network: Network,
  oracleVkh: string,
): CdtContracts {
  const blueprint = loadBlueprint();

  const vaultScript: Script = {
    type: "PlutusV3",
    script: applyDoubleCborEncoding(
      findValidator(blueprint, "cd_vault.cd_vault.spend").compiledCode,
    ),
  };
  const vaultHash = validatorToScriptHash(vaultScript);
  const vaultAddress = validatorToAddress(network, vaultScript);

  const mintScript: Script = {
    type: "PlutusV3",
    script: applyParamsToScript(
      findValidator(blueprint, "cdt_mint.cdt_mint.mint").compiledCode,
      [oracleVkh, vaultHash],
    ),
  };
  const policyId = mintingPolicyToId(mintScript);

  return { vaultScript, vaultHash, vaultAddress, mintScript, policyId };
}
