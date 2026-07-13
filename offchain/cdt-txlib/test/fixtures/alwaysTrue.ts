/**
 * Vendored always-succeeds Plutus V3 scripts (CBOR-wrapped flat UPLC), used
 * to exercise the tx builders on the Lucid Emulator without depending on the
 * real on-chain (Aiken) unit.
 *
 * `450101002499` decodes to `program 1.1.0 (lam _ (con unit ()))`:
 * a one-argument script (V3 validators receive only the script context) that
 * always returns unit, i.e. always succeeds.
 *
 * `46010100222499` decodes to
 * `program 1.1.0 (lam a (lam b (lam c (con unit ()))))`:
 * the same, but expecting two applied parameters (oracle_vkh, vault_hash)
 * before the script-context argument, matching the parameterization of the
 * real CDT minting policy.
 */
import type { Blueprint } from "../../src/blueprint.js";

/** Always-true V3 spend validator: takes only the script context. */
export const ALWAYS_TRUE_V3 = "450101002499";

/** Always-true V3 mint policy: takes 2 parameters + the script context. */
export const ALWAYS_TRUE_V3_2PARAMS = "46010100222499";

/**
 * A CIP-57 blueprint (the `plutus.json` shape produced by `aiken build`)
 * wired with the always-succeeds scripts, mimicking the real CDT blueprint's
 * validator titles — including the `*.else` fallback handlers Aiken emits,
 * which the script resolution must never pick up.
 */
export function fixtureBlueprint(): Blueprint {
  return {
    preamble: {
      title: "cdt/fixtures",
      description: "Always-succeeds stand-ins for the CDT validators",
      version: "0.0.0",
      plutusVersion: "v3",
      compiler: { name: "hand-rolled", version: "0" },
    },
    validators: [
      {
        title: "cdt.cdt.mint",
        compiledCode: ALWAYS_TRUE_V3_2PARAMS,
        parameters: [{ title: "oracle_vkh" }, { title: "vault_hash" }],
      },
      {
        title: "cdt.cdt.else",
        compiledCode: ALWAYS_TRUE_V3,
        parameters: [{ title: "oracle_vkh" }, { title: "vault_hash" }],
      },
      {
        title: "vault.vault.spend",
        compiledCode: ALWAYS_TRUE_V3,
      },
      {
        title: "vault.vault.else",
        compiledCode: ALWAYS_TRUE_V3_2PARAMS,
      },
    ],
  };
}
