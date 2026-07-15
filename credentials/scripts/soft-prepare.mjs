#!/usr/bin/env node
/**
 * Soft prepare for monorepo `file:` consumers. See offchain/cdt-txlib/scripts/soft-prepare.mjs.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const tscJs = join(root, "node_modules", "typescript", "lib", "tsc.js");
const project = process.argv[2] || "tsconfig.json";

if (!existsSync(tscJs)) {
  console.warn(
    `[prepare] skip: typescript not installed in ${root} (normal for nested file: installs)`,
  );
  process.exit(0);
}

const result = spawnSync(process.execPath, [tscJs, "-p", project], {
  cwd: root,
  stdio: "inherit",
});
process.exit(result.status === null ? 1 : result.status);
