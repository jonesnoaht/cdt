#!/usr/bin/env node
// Ensures the local file: dependencies (@cdt/txlib, @cdt/credentials) are
// built and linked before the demo tests/runs. Runs at the start of
// `npm test`, `npm run demo`, and `npm run typecheck`.
//
// Why this exists: both packages emit their compiled output to a git-ignored
// dist/ via their `prepare` script. During `npm ci` in the demo, npm runs
// those `prepare` scripts mid-reify — before the dependencies' own
// devDependencies (typescript) exist — so on a fresh checkout they fail with
// `tsc: command not found`. The demo therefore declares them as
// optionalDependencies (a failed optional install is skipped instead of
// failing `npm ci`), and this script repairs the state afterwards:
//
//   1. run `npm ci` inside each dependency, which installs its toolchain and
//      triggers its own `prepare` build (dist/); rebuild when sources are
//      newer than the built output;
//   2. if npm dropped the optional links during the demo's install, run
//      `npm ci` in the demo again — with the dependencies now built, their
//      prepare succeeds and the links materialize.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const demoDir = resolve(here, "..");

// When this script runs as an npm script hook, npm exports its CLI flags and
// script context as npm_* environment variables, which the nested npm
// invocations below inherit. Some of them change install semantics (the
// original failure: npm_config_package_lock_only made a nested `npm ci`
// misbehave; npm_config_local_prefix would point the nested npm at the demo
// instead of the dependency). Strip those, but keep genuinely environmental
// npm config such as registry/proxy/cache settings a user or CI provides.
const STRIPPED_EXACT = new Set([
  "npm_command",
  "npm_config_package_lock_only",
  "npm_config_package_lock",
  "npm_config_ignore_scripts",
  "npm_config_dry_run",
  "npm_config_omit",
  "npm_config_include",
  "npm_config_save",
  "npm_config_save_dev",
  "npm_config_save_exact",
  "npm_config_save_optional",
  "npm_config_save_peer",
  "npm_config_save_prod",
  "npm_config_global",
  "npm_config_location",
  "npm_config_install_links",
  "npm_config_workspace",
  "npm_config_workspaces",
  "npm_config_include_workspace_root",
  "npm_config_prefix",
  "npm_config_local_prefix",
  "npm_config_global_prefix",
]);
const STRIPPED_PREFIXES = ["npm_lifecycle_", "npm_package_"];
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => {
    const lower = key.toLowerCase();
    return (
      !STRIPPED_EXACT.has(lower) &&
      !STRIPPED_PREFIXES.some((prefix) => lower.startsWith(prefix))
    );
  }),
);

/** Run npm with `args` in `cwd`; returns true on success, logs on failure. */
function npm(args, cwd) {
  const result = spawnSync("npm", args, {
    cwd,
    stdio: "inherit",
    env,
    // npm is npm.cmd on Windows and needs a shell there.
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(`[build-deps] failed to spawn npm: ${result.error.message}`);
    return false;
  }
  return result.status === 0;
}

/** Newest mtime (ms) of a file tree; 0 for paths that do not exist. */
function newestMtime(path) {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    return 0;
  }
  if (!stats.isDirectory()) return stats.mtimeMs;
  let newest = stats.mtimeMs;
  for (const entry of readdirSync(path)) {
    newest = Math.max(newest, newestMtime(join(path, entry)));
  }
  return newest;
}

const deps = [
  { name: "@cdt/txlib", dir: resolve(here, "..", "..", "cdt-txlib") },
  { name: "@cdt/credentials", dir: resolve(here, "..", "..", "..", "credentials") },
];

for (const dep of deps) {
  const built = join(dep.dir, "dist", "index.js");
  const toolchain = join(dep.dir, "node_modules", "typescript", "lib", "tsc.js");
  const sourcesMtime = Math.max(
    newestMtime(join(dep.dir, "src")),
    newestMtime(join(dep.dir, "package.json")),
    newestMtime(join(dep.dir, "tsconfig.json")),
    newestMtime(join(dep.dir, "tsconfig.build.json")),
  );
  const isStale = existsSync(built) && newestMtime(built) < sourcesMtime;
  if (existsSync(built) && !isStale && existsSync(toolchain)) {
    console.log(`[build-deps] ${dep.name} already built (${built})`);
    continue;
  }

  console.log(
    `[build-deps] ${isStale ? "rebuilding stale" : "building"} ${dep.name} in ${dep.dir} ...`,
  );
  // Always reinstall when toolchain is missing (partial/failed prior install).
  if (!existsSync(toolchain)) {
    if (!npm(["ci", "--include=dev", "--no-audit", "--no-fund"], dep.dir)) {
      console.error(`[build-deps] npm ci failed for ${dep.name}`);
      process.exit(1);
    }
  }
  if (!existsSync(built) || isStale) {
    if (!npm(["run", "build"], dep.dir) || !existsSync(built)) {
      console.error(`[build-deps] build failed for ${dep.name}`);
      process.exit(1);
    }
  }
  console.log(`[build-deps] ${dep.name} ready`);
}

// Materialize the optional file: links if npm dropped them during a cold
// `npm ci` (see header comment). Prefer a second `npm ci` so the lockfile is
// honored; if npm still omits optional links, fall back to explicit symlinks.
const missingLinks = deps.filter(
  (dep) => !existsSync(join(demoDir, "node_modules", ...dep.name.split("/"))),
);
if (missingLinks.length > 0) {
  console.log(
    `[build-deps] linking ${missingLinks.map((d) => d.name).join(", ")} into the demo ...`,
  );
  if (!npm(["ci", "--include=dev", "--no-audit", "--no-fund"], demoDir)) {
    console.warn(
      "[build-deps] npm ci failed while linking; will try direct symlinks",
    );
  }
  for (const dep of missingLinks) {
    const linkPath = join(demoDir, "node_modules", ...dep.name.split("/"));
    if (existsSync(linkPath)) continue;
    const parent = dirname(linkPath);
    mkdirSync(parent, { recursive: true });
    const target = relative(parent, dep.dir);
    console.log(`[build-deps] symlink ${linkPath} -> ${target}`);
    try {
      symlinkSync(target, linkPath, "dir");
    } catch (err) {
      console.error(`[build-deps] failed to symlink ${dep.name}: ${err}`);
      process.exit(1);
    }
    if (!existsSync(linkPath)) {
      console.error(`[build-deps] ${dep.name} is still missing after symlink`);
      process.exit(1);
    }
  }
}
