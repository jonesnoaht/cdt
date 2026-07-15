/**
 * Role-based institutional API keys.
 */
import { describe, expect, it } from "vitest";
import {
  requireRole,
  settlementRoleForPath,
  type RoleKeys,
} from "../src/server/security.js";

function mockCtx(headers: Record<string, string>) {
  return {
    req: {
      header: (name: string) => headers[name.toLowerCase()] ?? headers[name],
      path: "/api/presentments",
      method: "POST",
    },
    json: (body: unknown, status?: number) => ({ body, status: status ?? 200 }),
  } as never;
}

describe("settlementRoleForPath", () => {
  it("maps network steps to roles", () => {
    expect(settlementRoleForPath("/api/presentments", "POST")).toBe("correspondent");
    expect(settlementRoleForPath("/api/presentments/1/authorize", "POST")).toBe("issuer");
    expect(settlementRoleForPath("/api/presentments/1/burn-evidence", "POST")).toBe(
      "correspondent",
    );
    expect(settlementRoleForPath("/api/presentments/1/accept-burn", "POST")).toBe("issuer");
    expect(settlementRoleForPath("/api/settlement/pubkey", "GET")).toBe("public");
  });
});

describe("requireRole", () => {
  const keys: RoleKeys = {
    issuerKey: "issuer-secret",
    correspondentKey: "corr-secret",
  };

  it("allows issuer key on issuer role", async () => {
    let called = false;
    const mw = requireRole(keys, "issuer");
    await mw(
      mockCtx({ "x-api-key": "issuer-secret" }),
      (async () => {
        called = true;
      }) as never,
    );
    expect(called).toBe(true);
  });

  it("rejects correspondent key on issuer role", async () => {
    const mw = requireRole(keys, "issuer");
    const res = (await mw(
      mockCtx({ "x-api-key": "corr-secret" }),
      (async () => undefined) as never,
    )) as { status: number };
    expect(res.status).toBe(403);
  });

  it("allows either key for any", async () => {
    let called = false;
    const mw = requireRole(keys, "any");
    await mw(
      mockCtx({ "x-api-key": "corr-secret" }),
      (async () => {
        called = true;
      }) as never,
    );
    expect(called).toBe(true);
  });
});
