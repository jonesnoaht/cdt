/**
 * CIP-57 blueprint (`plutus.json`) handling.
 *
 * The tx builders take a blueprint produced by `aiken build` and resolve the
 * CDT minting policy (parameterized by `(oracle_vkh, vault_hash)`) and the
 * vault spending validator from it.
 */
import {
  applyDoubleCborEncoding,
  applyParamsToScript,
  mintingPolicyToId,
  validatorToAddress,
  validatorToScriptHash,
  type LucidEvolution,
  type Network,
  type PolicyId,
  type Script,
  type ScriptType,
} from "@lucid-evolution/lucid";

/** Minimal CIP-57 blueprint shape produced by `aiken build`. */
export interface Blueprint {
  preamble: {
    title?: string;
    version?: string;
    plutusVersion?: string;
    [key: string]: unknown;
  };
  validators: BlueprintValidator[];
  [key: string]: unknown;
}

export interface BlueprintValidator {
  title: string;
  compiledCode: string;
  hash?: string;
  /** CIP-57 parameter schemas ("parameters" in plutus.json), when present. */
  parameters?: unknown[];
  [key: string]: unknown;
}

/** Options for resolving the CDT scripts out of a blueprint. */
export interface ResolveScriptsParams {
  /** The CIP-57 blueprint JSON (`plutus.json` from `aiken build`). */
  blueprint: Blueprint;
  /** Hex-encoded verification key hash of the oracle watcher (28 bytes). */
  oracleVkh: string;
  /**
   * Title (exact, purpose suffix, or substring) locating the mint validator
   * in the blueprint. Defaults to `"mint"`.
   */
  mintTitle?: string;
  /**
   * Title (exact, purpose suffix, or substring) locating the vault spending
   * validator in the blueprint. Defaults to `"vault"`, falling back to
   * `"spend"`.
   */
  vaultTitle?: string;
}

/** The resolved, fully-applied CDT scripts and derived values. */
export interface CdtScripts {
  /** CDT minting policy with `(oracle_vkh, vault_hash)` applied. */
  mintPolicy: Script;
  /** Vault spending validator (as compiled; no parameters applied). */
  vaultValidator: Script;
  /** Policy id of the applied minting policy. */
  policyId: PolicyId;
  /** Script hash of the vault validator (2nd parameter of the policy). */
  vaultHash: string;
  /** Bech32 address of the vault validator on `network`. */
  vaultAddress: string;
  /** Normalized (lowercase) oracle vkh applied as the 1st policy parameter. */
  oracleVkh: string;
  network: Network;
}

const HEX_RE = /^([0-9a-fA-F]{2})*$/;

/** Assert `value` is hex of `bytes` bytes (if given). Returns lowercased hex. */
export function assertHexBytes(
  name: string,
  value: string,
  bytes?: number,
): string {
  if (!HEX_RE.test(value)) {
    throw new Error(`${name} must be hex-encoded bytes, got "${value}"`);
  }
  if (bytes !== undefined && value.length !== bytes * 2) {
    throw new Error(
      `${name} must be ${bytes} bytes (${bytes * 2} hex chars), got ${value.length / 2} bytes`,
    );
  }
  return value.toLowerCase();
}

function plutusScriptType(blueprint: Blueprint): Exclude<ScriptType, "Native"> {
  switch (blueprint.preamble?.plutusVersion) {
    case "v1":
      return "PlutusV1";
    case "v2":
      return "PlutusV2";
    case "v3":
      return "PlutusV3";
    default:
      // The language tag participates in script hashing, so guessing here
      // would silently derive wrong hashes/addresses. Require it.
      throw new Error(
        `Blueprint preamble is missing a supported plutusVersion (got ${JSON.stringify(
          blueprint.preamble?.plutusVersion,
        )}; expected "v1" | "v2" | "v3")`,
      );
  }
}

/**
 * Locate a validator by needle, most-specific first:
 *
 * 1. exact title match;
 * 2. purpose match: Aiken titles are `module.validator.purpose`, so match
 *    the last dot-separated segment;
 * 3. substring match.
 *
 * `*.else` handlers are never matched except by exact title, and an
 * ambiguous needle (two matches with different code) is an error rather
 * than a silent first-hit.
 */
function findValidator(
  blueprint: Blueprint,
  needles: string[],
  what: string,
): BlueprintValidator {
  if (!Array.isArray(blueprint.validators) || blueprint.validators.length === 0) {
    throw new Error("Blueprint has no validators");
  }
  const pick = (matches: BlueprintValidator[]): BlueprintValidator | undefined => {
    const distinct = new Set(matches.map((v) => v.compiledCode));
    if (distinct.size > 1) {
      throw new Error(
        `Ambiguous ${what} validator lookup in blueprint; matches: ${matches
          .map((v) => v.title)
          .join(", ")}. Pass an explicit ${what}Title.`,
      );
    }
    return matches[0];
  };
  for (const needle of needles) {
    const exact = blueprint.validators.filter((v) => v.title === needle);
    const found =
      pick(exact) ??
      pick(
        blueprint.validators.filter(
          (v) => v.title.split(".").at(-1) === needle,
        ),
      ) ??
      pick(
        blueprint.validators.filter(
          (v) => !v.title.endsWith(".else") && v.title.includes(needle),
        ),
      );
    if (found) return found;
  }
  throw new Error(
    `Could not find ${what} validator in blueprint (looked for ${needles
      .map((n) => `"${n}"`)
      .join(", ")}). Available: ${blueprint.validators.map((v) => v.title).join(", ")}`,
  );
}

/**
 * Resolve the CDT scripts from a CIP-57 blueprint:
 *
 * 1. locate the vault spending validator, compute its script hash + address;
 * 2. locate the mint validator and apply `(oracle_vkh, vault_hash)` to it via
 *    {@link applyParamsToScript};
 * 3. derive the CDT policy id.
 *
 * When the blueprint declares `parameters` / `hash` for a validator they are
 * cross-checked (mint must take exactly 2 parameters, vault none, and the
 * vault's computed script hash must equal the declared one).
 */
export function resolveCdtScripts(
  lucid: LucidEvolution,
  params: ResolveScriptsParams,
): CdtScripts {
  const { blueprint } = params;
  const oracleVkh = assertHexBytes("oracleVkh", params.oracleVkh, 28);
  const network = lucid.config().network;
  if (!network) {
    throw new Error("Lucid instance has no network configured");
  }
  const scriptType = plutusScriptType(blueprint);

  const vaultBp = findValidator(
    blueprint,
    params.vaultTitle ? [params.vaultTitle] : ["vault", "spend"],
    "vault",
  );
  if (Array.isArray(vaultBp.parameters) && vaultBp.parameters.length !== 0) {
    throw new Error(
      `Vault validator "${vaultBp.title}" declares ${vaultBp.parameters.length} parameter(s); expected an unparameterized validator`,
    );
  }
  const vaultValidator: Script = {
    type: scriptType,
    script: applyDoubleCborEncoding(vaultBp.compiledCode),
  };
  const vaultHash = validatorToScriptHash(vaultValidator);
  if (vaultBp.hash !== undefined && vaultBp.hash !== vaultHash) {
    throw new Error(
      `Vault validator "${vaultBp.title}": computed script hash ${vaultHash} does not match the blueprint's declared hash ${vaultBp.hash}`,
    );
  }
  const vaultAddress = validatorToAddress(network, vaultValidator);

  const mintBp = findValidator(
    blueprint,
    params.mintTitle ? [params.mintTitle] : ["mint"],
    "mint",
  );
  if (Array.isArray(mintBp.parameters) && mintBp.parameters.length !== 2) {
    throw new Error(
      `Mint validator "${mintBp.title}" declares ${mintBp.parameters.length} parameter(s); expected 2 (oracle_vkh, vault_hash)`,
    );
  }
  const mintPolicy: Script = {
    type: scriptType,
    script: applyParamsToScript(mintBp.compiledCode, [oracleVkh, vaultHash]),
  };
  const policyId = mintingPolicyToId(mintPolicy);

  return {
    mintPolicy,
    vaultValidator,
    policyId,
    vaultHash,
    vaultAddress,
    oracleVkh,
    network,
  };
}
