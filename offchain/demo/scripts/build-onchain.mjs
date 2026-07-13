#!/usr/bin/env node
// Builds the vendored Aiken project (onchain-vendored/) into plutus.json.
//
// The built plutus.json is committed to the repository, so the demo and the
// test suite keep working even on machines without an Aiken toolchain — in
// that case this script only verifies the committed blueprint exists.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const onchainDir = join(here, "..", "onchain-vendored");
const blueprint = join(onchainDir, "plutus.json");

const probe = spawnSync("aiken", ["--version"], { encoding: "utf8" });

if (probe.error || probe.status !== 0) {
  if (existsSync(blueprint)) {
    console.log(
      "[build-onchain] aiken not found on PATH; using committed plutus.json",
    );
    process.exit(0);
  }
  console.error(
    "[build-onchain] aiken not found and no committed plutus.json present.",
  );
  console.error(
    '[build-onchain] Install Aiken v1.1.23 (https://aiken-lang.org) or restore onchain-vendored/plutus.json.',
  );
  process.exit(1);
}

console.log(`[build-onchain] ${probe.stdout.trim()} — building ${onchainDir}`);
const build = spawnSync("aiken", ["build"], {
  cwd: onchainDir,
  stdio: "inherit",
});

if (build.status !== 0) {
  console.error("[build-onchain] aiken build failed");
  process.exit(build.status ?? 1);
}

if (!existsSync(blueprint)) {
  console.error("[build-onchain] aiken build succeeded but plutus.json is missing");
  process.exit(1);
}

console.log("[build-onchain] blueprint ready:", blueprint);
