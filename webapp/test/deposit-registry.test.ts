/**
 * Deposit registry unit tests (in-memory path).
 */
import { describe, expect, it } from "vitest";
import { DepositRegistry } from "../src/server/deposit-registry.js";

describe("DepositRegistry memory", () => {
  it("attested → minted → burned", async () => {
    const reg = new DepositRegistry();
    await reg.init();
    const a = await reg.recordAttested({
      depositId: "d1",
      accountId: "9",
      attestationHash: "aa".repeat(32),
    });
    expect("error" in a).toBe(false);
    if ("error" in a) return;
    expect(a.state).toBe("attested");

    const m = await reg.recordMinted({ depositId: "d1", mintTxHash: "m".repeat(64) });
    expect("error" in m).toBe(false);
    if ("error" in m) return;
    expect(m.state).toBe("minted");

    const b = await reg.recordBurned({ depositId: "d1", burnTxHash: "b".repeat(64) });
    expect("error" in b).toBe(false);
    if ("error" in b) return;
    expect(b.state).toBe("burned");

    const again = await reg.recordBurned({ depositId: "d1", burnTxHash: "c".repeat(64) });
    expect("error" in again).toBe(true);
  });

  it("idempotent same burn tx", async () => {
    const reg = new DepositRegistry();
    const hash = "e".repeat(64);
    await reg.recordBurned({ depositId: "d2", burnTxHash: hash });
    const again = await reg.recordBurned({ depositId: "d2", burnTxHash: hash });
    expect("error" in again).toBe(false);
  });
});
