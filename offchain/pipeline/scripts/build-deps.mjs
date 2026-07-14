#!/usr/bin/env node
/**
 * Build the sibling workspace packages this pipeline depends on, without
 * modifying them: each gets a plain `npm ci` in its own directory, which
 * installs its dependencies and (via its own `prepare` script, where one
 * exists) emits its `dist/`.
 *
 * This runs as `preinstall` and `pretest` so a clean checkout works with
 * just `npm ci && npm test`. Sibling installs are skipped when their
 * node_modules is already up to date with their lockfile (cheap mtime check)
 * so repeated runs stay fast.
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");

const siblings = [
  { dir: resolve(pkgRoot, "../cdt-txlib"), builds: "dist" },
  { dir: resolve(pkgRoot, "../oracle-watcher"), builds: null },
  { dir: resolve(pkgRoot, "../../bank-sim"), builds: null },
  { dir: resolve(pkgRoot, "../../credentials"), builds: "dist" },
];

// A nested `npm ci` inherits npm_config_* / npm_lifecycle_* variables from
// the parent npm process; strip them so the sibling install behaves exactly
// like a standalone `npm ci` in that directory.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k)),
);

function upToDate({ dir, builds }) {
  const stamp = join(dir, "node_modules", ".package-lock.json");
  const lock = join(dir, "package-lock.json");
  if (!existsSync(stamp) || !existsSync(lock)) return false;
  if (statSync(stamp).mtimeMs < statSync(lock).mtimeMs) return false;
  if (builds && !existsSync(join(dir, builds))) return false;
  return true;
}

for (const sibling of siblings) {
  if (upToDate(sibling)) continue;
  console.log(`[build-deps] npm ci in ${sibling.dir}`);
  execFileSync("npm", ["ci", "--no-audit", "--no-fund"], {
    cwd: sibling.dir,
    stdio: "inherit",
    env,
  });
}
