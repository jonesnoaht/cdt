/**
 * Sign-request store + ACH HTTP rail tests.
 */
import { describe, expect, it } from "vitest";
import { SignRequestStore } from "../src/server/sign-requests.js";
import { HttpAchRail, MockAchRail, settlementRailFromEnv } from "../src/server/settlement-rail.js";

describe("SignRequestStore", () => {
  it("creates QR claim URL without embedding full CBOR in QR data URL length sanity", async () => {
    const store = new SignRequestStore();
    // ~2KB of hex (~1KB bytes) — too big for comfortable single QR of CBOR itself
    const cborHex = "ab".repeat(1024);
    const dto = await store.create({
      purpose: "redeem",
      cborHex,
      depositId: "dep-qr-1",
      publicBaseUrl: "http://localhost:5173/#",
    });
    expect(dto.id).toMatch(/^[a-f0-9]{32}$/);
    expect(dto.claimUrl).toContain(dto.id);
    expect(dto.qrDataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(dto.cborHex).toBe(cborHex);
    expect(dto.status).toBe("pending");
  });

  it("completes with signed hex and is idempotent", async () => {
    const store = new SignRequestStore();
    const dto = await store.create({
      purpose: "burn",
      cborHex: "deadbeef",
      publicBaseUrl: "https://desk.example/#",
    });
    const done = store.complete(dto.id, { signedCborHex: "cafebabe" });
    expect("error" in done).toBe(false);
    if ("error" in done) return;
    expect(done.status).toBe("completed");
    expect(done.signedCborHex).toBe("cafebabe");
    const again = store.complete(dto.id, { signedCborHex: "cafebabe" });
    expect("error" in again).toBe(false);
  });

  it("expires pending requests", async () => {
    const store = new SignRequestStore();
    const dto = await store.create({
      purpose: "generic",
      cborHex: "aa",
      publicBaseUrl: "http://x/#",
      ttlMs: 1,
    });
    await new Promise((r) => setTimeout(r, 5));
    const got = store.get(dto.id, Date.now() + 100);
    expect(got?.status).toBe("expired");
  });
});

describe("HttpAchRail", () => {
  it("posts and returns traceId", async () => {
    const rail = new HttpAchRail("http://ach.local/pay", "tok", async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { amountCents: number };
      expect(body.amountCents).toBe(500_00);
      return new Response(JSON.stringify({ traceId: "ACH-1", paidAt: "2030-01-01T00:00:00.000Z" }), {
        status: 200,
      });
    });
    const result = await rail.pay(
      {
        presentmentId: 1,
        amountCents: 500_00,
        currency: "USD",
        beneficiaryRef: "gulfside",
        originatorRef: "campususa",
        depositId: "dep-1",
      },
      Date.parse("2030-01-01T00:00:00.000Z"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.traceId).toBe("ACH-1");
  });

  it("maps 4xx to RAIL_REJECTED", async () => {
    const rail = new HttpAchRail("http://ach.local/pay", undefined, async () =>
      new Response(JSON.stringify({ reason: "NSF" }), { status: 422 }),
    );
    const result = await rail.pay(
      {
        presentmentId: 2,
        amountCents: 1,
        currency: "USD",
        beneficiaryRef: "a",
        originatorRef: "b",
        depositId: "d",
      },
      Date.now(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("RAIL_REJECTED");
  });

  it("settlementRailFromEnv http requires URL", () => {
    expect(() =>
      settlementRailFromEnv({ SETTLEMENT_RAIL: "http" } as NodeJS.ProcessEnv),
    ).toThrow(/SETTLEMENT_ACH_URL/);
  });

  it("mock still works", async () => {
    const rail = new MockAchRail();
    const r = await rail.pay(
      {
        presentmentId: 9,
        amountCents: 10,
        currency: "USD",
        beneficiaryRef: "a",
        originatorRef: "b",
        depositId: "d",
      },
      1,
    );
    expect(r.ok).toBe(true);
  });
});
