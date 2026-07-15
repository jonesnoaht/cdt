import { Constr, Data, fromText, toHex } from "@lucid-evolution/lucid";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CDDatum, MintRedeemer, VaultRedeemer } from "../src/types.js";

const sampleDatum: CDDatum = {
  owner: "aa".repeat(28),
  issuer: "bb".repeat(28),
  deposit_id: fromText("cdt-1"),
  principal: 1_000_000_000n,
  rate_bps: 500n,
  start: 1_700_000_000_000n,
  maturity: 1_731_557_600_000n,
  penalty_bps: 2_000n,
  cdt_policy: "cc".repeat(28),
  account_id: fromText("42"),
  attestation_hash: "01".repeat(32),
};

describe("CDDatum", () => {
  it("round-trips through Data.to / Data.from", () => {
    const cbor = Data.to(sampleDatum, CDDatum);
    expect(Data.from(cbor, CDDatum)).toEqual(sampleDatum);
  });

  it("encodes as constructor 0 with fields in declaration order", () => {
    const raw = Data.from(Data.to(sampleDatum, CDDatum));
    expect(raw).toBeInstanceOf(Constr);
    const constr = raw as Constr<Data>;
    expect(constr.index).toBe(0);
    expect(constr.fields).toEqual([
      sampleDatum.owner,
      sampleDatum.issuer,
      sampleDatum.deposit_id,
      sampleDatum.principal,
      sampleDatum.rate_bps,
      sampleDatum.start,
      sampleDatum.maturity,
      sampleDatum.penalty_bps,
      sampleDatum.cdt_policy,
      sampleDatum.account_id,
      sampleDatum.attestation_hash,
    ]);
  });

  it("round-trips arbitrary datums (property)", () => {
    const hex = (bytes: number) =>
      fc.uint8Array({ minLength: bytes, maxLength: bytes }).map(toHex);
    const varHex = fc
      .uint8Array({ minLength: 0, maxLength: 32 })
      .map(toHex);
    const nat = fc.bigInt({ min: 0n, max: 2n ** 63n });
    const datumArb = fc.record({
      owner: hex(28),
      issuer: varHex,
      deposit_id: varHex,
      principal: nat,
      rate_bps: nat,
      start: nat,
      maturity: nat,
      penalty_bps: nat,
      cdt_policy: hex(28),
      account_id: varHex,
      attestation_hash: hex(32),
    });
    fc.assert(
      fc.property(datumArb, (datum) => {
        const decoded = Data.from(Data.to(datum, CDDatum), CDDatum);
        expect(decoded).toEqual(datum);
      }),
    );
  });
});

describe("VaultRedeemer", () => {
  it("Redeem is constr 0 with no fields", () => {
    expect(Data.to("Redeem", VaultRedeemer)).toBe("d87980");
  });

  it("EarlyWithdraw is constr 1 with no fields", () => {
    expect(Data.to("EarlyWithdraw", VaultRedeemer)).toBe("d87a80");
  });

  it("round-trips", () => {
    for (const v of ["Redeem", "EarlyWithdraw"] as const) {
      expect(Data.from(Data.to(v, VaultRedeemer), VaultRedeemer)).toBe(v);
    }
  });
});

describe("MintRedeemer", () => {
  it("MintCD is constr 0 wrapping the datum as its single field", () => {
    const value: MintRedeemer = { MintCD: { datum: sampleDatum } };
    const raw = Data.from(Data.to(value, MintRedeemer));
    expect(raw).toBeInstanceOf(Constr);
    const constr = raw as Constr<Data>;
    expect(constr.index).toBe(0);
    expect(constr.fields).toHaveLength(1);
    const datumConstr = constr.fields[0] as Constr<Data>;
    expect(datumConstr.index).toBe(0);
    expect(datumConstr.fields).toHaveLength(11);
    // The wrapped datum must encode identically to a standalone CDDatum.
    expect(Data.to(datumConstr as Data)).toBe(Data.to(sampleDatum, CDDatum));
  });

  it("BurnCD is constr 1 with no fields", () => {
    expect(Data.to("BurnCD", MintRedeemer)).toBe("d87a80");
  });

  it("round-trips", () => {
    const mint: MintRedeemer = { MintCD: { datum: sampleDatum } };
    expect(Data.from(Data.to(mint, MintRedeemer), MintRedeemer)).toEqual(mint);
    expect(Data.from(Data.to("BurnCD", MintRedeemer), MintRedeemer)).toBe(
      "BurnCD",
    );
  });
});
