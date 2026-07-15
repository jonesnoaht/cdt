/**
 * Unit tests for burn validation (no live Koios).
 */
import { describe, expect, it } from "vitest";
import {
  assetNameHexFromText,
  findCdtBurn,
  validateBurnTx,
} from "../src/server/burn-validate.js";

describe("assetNameHexFromText", () => {
  it("encodes deposit ids like fromText", () => {
    expect(assetNameHexFromText("1")).toBe(Buffer.from("1", "utf8").toString("hex"));
    expect(assetNameHexFromText("DEP-1")).toBe(
      Buffer.from("DEP-1", "utf8").toString("hex"),
    );
  });
});

describe("findCdtBurn", () => {
  const depositId = "42";
  const nameHex = assetNameHexFromText(depositId);
  const policy = "ab".repeat(28);

  it("finds a negative mint quantity for the deposit asset", () => {
    const hit = findCdtBurn(
      {
        mint: [
          { policy_id: policy, asset_name: nameHex, quantity: "-1" },
          { policy_id: policy, asset_name: nameHex, quantity: "1" },
        ],
      },
      depositId,
      policy,
    );
    expect(hit).toEqual({
      policyId: policy,
      assetNameHex: nameHex,
      quantity: "-1",
    });
  });

  it("rejects wrong policy when policyId is required", () => {
    const hit = findCdtBurn(
      {
        mint: [{ policy_id: "00".repeat(28), asset_name: nameHex, quantity: "-1" }],
      },
      depositId,
      policy,
    );
    expect(hit).toBeNull();
  });

  it("rejects mints that are not burns", () => {
    const hit = findCdtBurn(
      {
        mint: [{ policy_id: policy, asset_name: nameHex, quantity: "1" }],
      },
      depositId,
    );
    expect(hit).toBeNull();
  });
});

describe("validateBurnTx", () => {
  const depositId = "7";
  const nameHex = assetNameHexFromText(depositId);
  const txHash = "cd".repeat(32);

  it("mode=off always ok without network", async () => {
    const r = await validateBurnTx({
      provider: undefined,
      koiosBaseUrl: "https://example.invalid",
      txHash,
      depositId,
      mode: "off",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.onChain).toBe(false);
  });

  it("strict without provider fails closed", async () => {
    const r = await validateBurnTx({
      provider: undefined,
      koiosBaseUrl: "https://example.invalid",
      txHash,
      depositId,
      mode: "strict",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonCode).toBe("PROVIDER_UNCONFIGURED");
  });

  it("strict accepts a koios burn payload", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify([
          {
            tx_hash: txHash,
            mint: [{ policy_id: "ff".repeat(28), asset_name: nameHex, quantity: "-1" }],
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const r = await validateBurnTx({
      provider: "koios-preview",
      koiosBaseUrl: "https://koios.test/api/v1",
      txHash,
      depositId,
      mode: "strict",
      fetchImpl,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.onChain).toBe(true);
      expect(r.burnedQuantity).toBe("-1");
    }
  });

  it("strict rejects tx with no matching burn", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify([{ tx_hash: txHash, mint: [] }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const r = await validateBurnTx({
      provider: "koios-preview",
      koiosBaseUrl: "https://koios.test/api/v1",
      txHash,
      depositId,
      mode: "strict",
      fetchImpl,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonCode).toBe("TX_INVALID");
  });

  it("strict rejects missing tx", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const r = await validateBurnTx({
      provider: "koios-preview",
      koiosBaseUrl: "https://koios.test/api/v1",
      txHash,
      depositId,
      mode: "strict",
      fetchImpl,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonCode).toBe("TX_NOT_FOUND");
  });
});
