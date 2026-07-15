/**
 * Identity provider + wallet deep-link unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  MockIdentityProvider,
  HttpIdentityProvider,
  identityProviderFromEnv,
} from "../src/server/identity-provider.js";
import {
  buildWalletDeepLinks,
  deepLinkTemplateForBrand,
  listWalletBrands,
} from "../src/server/wallet-deeplinks.js";

describe("MockIdentityProvider", () => {
  const p = new MockIdentityProvider();
  it("rejects incomplete composite", async () => {
    const r = await p.check(
      {
        kind: "composite",
        subjectName: "Ada",
        cipComplete: true,
        ofacCleared: false,
        ownershipVerified: true,
      },
      1,
    );
    expect(r.ok).toBe(false);
    expect(r.reasons?.some((x) => /ofac/i.test(x))).toBe(true);
  });

  it("accepts full composite", async () => {
    const r = await p.check(
      {
        kind: "composite",
        subjectName: "Ada Lovelace",
        cipComplete: true,
        ofacCleared: true,
        ownershipVerified: true,
      },
      1,
    );
    expect(r.ok).toBe(true);
    expect(r.referenceId).toMatch(/^MOCK-IDV-/);
  });
});

describe("HttpIdentityProvider", () => {
  it("maps success", async () => {
    const p = new HttpIdentityProvider("http://idv.local/check", "t", async () =>
      new Response(JSON.stringify({ ok: true, referenceId: "IDV-9" }), { status: 200 }),
    );
    const r = await p.check({ kind: "cip", subjectName: "X", cipComplete: true }, 1);
    expect(r.ok).toBe(true);
    expect(r.referenceId).toBe("IDV-9");
  });
});

describe("identityProviderFromEnv", () => {
  it("requires URL for http", () => {
    expect(() =>
      identityProviderFromEnv({ CDT_IDV_MODE: "http" } as NodeJS.ProcessEnv),
    ).toThrow(/CDT_IDV_URL/);
  });
});

describe("wallet deep links", () => {
  it("lists brands and builds claim-first options", () => {
    expect(listWalletBrands().length).toBeGreaterThan(3);
    const links = buildWalletDeepLinks("http://localhost:5173/#/sign/abc");
    expect(links[0]?.brand).toBe("claim_url");
    expect(links.some((l) => l.brand === "vespr" && l.url?.includes("vespr"))).toBe(true);
    expect(deepLinkTemplateForBrand("vespr")).toContain("{url}");
  });
});
