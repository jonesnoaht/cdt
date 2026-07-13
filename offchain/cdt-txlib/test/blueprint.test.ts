import {
  Emulator,
  Lucid,
  generateEmulatorAccount,
  type LucidEvolution,
} from "@lucid-evolution/lucid";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveCdtScripts, type Blueprint } from "../src/blueprint.js";
import {
  ALWAYS_TRUE_V3,
  ALWAYS_TRUE_V3_2PARAMS,
  fixtureBlueprint,
} from "./fixtures/alwaysTrue.js";

const ORACLE_VKH = "ab".repeat(28);

let lucid: LucidEvolution;
beforeAll(async () => {
  const account = generateEmulatorAccount({ lovelace: 100_000_000n });
  lucid = await Lucid(new Emulator([account]), "Custom");
});

describe("resolveCdtScripts", () => {
  it("resolves the mint and vault validators, skipping *.else handlers", () => {
    const scripts = resolveCdtScripts(lucid, {
      blueprint: fixtureBlueprint(),
      oracleVkh: ORACLE_VKH,
    });
    expect(scripts.policyId).toMatch(/^[0-9a-f]{56}$/);
    expect(scripts.vaultHash).toMatch(/^[0-9a-f]{56}$/);
    expect(scripts.vaultAddress).toMatch(/^addr_test1/);
    expect(scripts.oracleVkh).toBe(ORACLE_VKH);
    // Applying different params yields a different policy id.
    const other = resolveCdtScripts(lucid, {
      blueprint: fixtureBlueprint(),
      oracleVkh: "00".repeat(28),
    });
    expect(other.policyId).not.toBe(scripts.policyId);
    expect(other.vaultHash).toBe(scripts.vaultHash);
  });

  it("normalizes the oracle vkh to lowercase", () => {
    const scripts = resolveCdtScripts(lucid, {
      blueprint: fixtureBlueprint(),
      oracleVkh: "AB".repeat(28),
    });
    expect(scripts.oracleVkh).toBe(ORACLE_VKH);
  });

  it("prefers a purpose-suffix match over a substring match", () => {
    const blueprint = fixtureBlueprint();
    // A module whose NAME contains "mint" but whose purpose is spend must
    // not shadow the real mint handler.
    blueprint.validators.unshift({
      title: "mint_vault.mint_vault.spend",
      compiledCode: ALWAYS_TRUE_V3,
    });
    const scripts = resolveCdtScripts(lucid, {
      blueprint,
      oracleVkh: ORACLE_VKH,
      vaultTitle: "vault.vault.spend",
    });
    const reference = resolveCdtScripts(lucid, {
      blueprint: fixtureBlueprint(),
      oracleVkh: ORACLE_VKH,
    });
    expect(scripts.policyId).toBe(reference.policyId);
  });

  it("throws on an ambiguous lookup instead of picking the first hit", () => {
    const blueprint = fixtureBlueprint();
    blueprint.validators.push({
      title: "other.other.mint",
      compiledCode: ALWAYS_TRUE_V3,
    });
    expect(() =>
      resolveCdtScripts(lucid, { blueprint, oracleVkh: ORACLE_VKH }),
    ).toThrow(/Ambiguous/);
    // An explicit exact title disambiguates.
    const scripts = resolveCdtScripts(lucid, {
      blueprint,
      oracleVkh: ORACLE_VKH,
      mintTitle: "cdt.cdt.mint",
    });
    expect(scripts.policyId).toMatch(/^[0-9a-f]{56}$/);
  });

  it("throws when a validator is missing", () => {
    const blueprint = fixtureBlueprint();
    blueprint.validators = blueprint.validators.filter(
      (v) => !v.title.includes("mint"),
    );
    expect(() =>
      resolveCdtScripts(lucid, { blueprint, oracleVkh: ORACLE_VKH }),
    ).toThrow(/Could not find mint/);
  });

  it("requires a supported plutusVersion in the preamble", () => {
    const blueprint = fixtureBlueprint();
    delete blueprint.preamble.plutusVersion;
    expect(() =>
      resolveCdtScripts(lucid, { blueprint, oracleVkh: ORACLE_VKH }),
    ).toThrow(/plutusVersion/);
  });

  it("cross-checks declared parameter counts", () => {
    const twoParamVault: Blueprint = fixtureBlueprint();
    twoParamVault.validators = [
      {
        title: "cdt.cdt.mint",
        compiledCode: ALWAYS_TRUE_V3_2PARAMS,
        parameters: [{}],
      },
      { title: "vault.vault.spend", compiledCode: ALWAYS_TRUE_V3 },
    ];
    expect(() =>
      resolveCdtScripts(lucid, {
        blueprint: twoParamVault,
        oracleVkh: ORACLE_VKH,
      }),
    ).toThrow(/expected 2/);

    const paramVault: Blueprint = fixtureBlueprint();
    paramVault.validators = [
      { title: "cdt.cdt.mint", compiledCode: ALWAYS_TRUE_V3_2PARAMS },
      {
        title: "vault.vault.spend",
        compiledCode: ALWAYS_TRUE_V3,
        parameters: [{ title: "unexpected" }],
      },
    ];
    expect(() =>
      resolveCdtScripts(lucid, {
        blueprint: paramVault,
        oracleVkh: ORACLE_VKH,
      }),
    ).toThrow(/unparameterized/);
  });

  it("cross-checks the vault's declared hash", () => {
    const good = resolveCdtScripts(lucid, {
      blueprint: fixtureBlueprint(),
      oracleVkh: ORACLE_VKH,
    });
    // Declaring the correct hash passes...
    const withHash = fixtureBlueprint();
    for (const v of withHash.validators) {
      if (v.title === "vault.vault.spend") v.hash = good.vaultHash;
    }
    expect(
      resolveCdtScripts(lucid, { blueprint: withHash, oracleVkh: ORACLE_VKH })
        .vaultHash,
    ).toBe(good.vaultHash);
    // ...a wrong one throws.
    const withBadHash = fixtureBlueprint();
    for (const v of withBadHash.validators) {
      if (v.title === "vault.vault.spend") v.hash = "00".repeat(28);
    }
    expect(() =>
      resolveCdtScripts(lucid, {
        blueprint: withBadHash,
        oracleVkh: ORACLE_VKH,
      }),
    ).toThrow(/declared hash/);
  });
});
