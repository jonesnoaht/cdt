/**
 * Production-oriented VC verification hook for the oracle watcher.
 *
 * Modes (env CDT_VC_MODE):
 *   fail_closed (default) — reject all presentations
 *   accept_all            — lab only (same as CDT_ORACLE_ACCEPT_ALL_VC=1)
 *   credentials           — verify mock W3C VPs via local vc-mock (Identus stand-in)
 *
 * Presentations for `credentials` mode are loaded from CDT_PRESENTATION_DIR
 * (one JSON file per member) or injected via PresentationDirectory.register.
 *
 * Production Identus: replace this module with a PRISM/Identus agent client.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  verifyPresentation,
  type MockPresentation,
} from "./vc-mock.js";
import type { VerifyPresentationHook, VerifyPresentationResult } from "./watcher.js";

export type VcMode = "fail_closed" | "accept_all" | "credentials";

export function vcModeFromEnv(env: NodeJS.ProcessEnv = process.env): VcMode {
  if (env.CDT_ORACLE_ACCEPT_ALL_VC === "1" || env.CDT_VC_MODE === "accept_all") {
    return "accept_all";
  }
  if (env.CDT_VC_MODE === "credentials") {
    return "credentials";
  }
  return "fail_closed";
}

export class PresentationDirectory {
  private readonly byDid = new Map<string, MockPresentation>();

  register(did: string, presentation: MockPresentation): void {
    this.byDid.set(did, presentation);
  }

  loadDir(dir: string): number {
    if (!existsSync(dir)) return 0;
    let n = 0;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const raw = JSON.parse(readFileSync(join(dir, name), "utf8")) as MockPresentation;
      const holder = raw.holder;
      if (typeof holder === "string" && holder) {
        this.byDid.set(holder, raw);
        n += 1;
      }
    }
    return n;
  }

  get(did: string): MockPresentation | undefined {
    return this.byDid.get(did);
  }
}

export function buildVerifyPresentationHook(opts: {
  mode: VcMode;
  trustedRootDid: string;
  directory?: PresentationDirectory;
  log?: (msg: string) => void;
}): VerifyPresentationHook {
  const dir = opts.directory ?? new PresentationDirectory();
  const log = opts.log ?? (() => undefined);

  return (memberDid: string): VerifyPresentationResult => {
    if (opts.mode === "accept_all") {
      log(`oracle-watcher: DEMO MODE — accepting VC for ${memberDid}`);
      return { verified: true };
    }
    if (opts.mode === "fail_closed") {
      return {
        verified: false,
        error:
          "VC verification fail-closed. Set CDT_VC_MODE=credentials with presentations, or CDT_ORACLE_ACCEPT_ALL_VC=1 for lab only.",
      };
    }

    const presentation = dir.get(memberDid);
    if (!presentation) {
      return {
        verified: false,
        error: `No presentation registered for member DID ${memberDid}`,
      };
    }

    const result = verifyPresentation(presentation, {
      trustedRootDid: opts.trustedRootDid,
      // Use the challenge embedded when the presentation was created.
      expectedChallenge: presentation.proof.challenge,
    });

    if (!result.ok) {
      return { verified: false, error: result.reason };
    }
    return { verified: true };
  };
}
