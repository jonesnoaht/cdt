import { describe, expect, it } from "vitest";
import { canonicalize } from "../src/canonicalize.js";

describe("canonicalize", () => {
  it("is invariant under object key order, recursively", () => {
    const a = {
      issuer: "did:key:zabc",
      credentialSubject: { name: "Alex", id: "did:key:zdef", nested: { y: 2, x: 1 } },
      type: ["VerifiableCredential", "AccountHolderCredential"],
    };
    const b = {
      type: ["VerifiableCredential", "AccountHolderCredential"],
      credentialSubject: { nested: { x: 1, y: 2 }, id: "did:key:zdef", name: "Alex" },
      issuer: "did:key:zabc",
    };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it("produces different output for different values", () => {
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: 2 }));
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ b: 1 }));
  });

  it("preserves array order", () => {
    expect(canonicalize([1, 2])).toBe("[1,2]");
    expect(canonicalize([2, 1])).toBe("[2,1]");
  });

  it("handles primitives, null, and undefined members like JSON.stringify", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize("hi")).toBe('"hi"');
    expect(canonicalize(42)).toBe("42");
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalize([undefined])).toBe("[null]");
  });

  it("round-trips through JSON.parse", () => {
    const value = { z: [1, { b: "x", a: null }], a: true };
    expect(JSON.parse(canonicalize(value))).toEqual(value);
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => canonicalize(Number.NaN)).toThrow();
  });

  it("honors toJSON so Dates canonicalize the same before and after a JSON round-trip", () => {
    const date = new Date("2019-08-01T00:00:00.000Z");
    expect(canonicalize({ memberSince: date })).toBe(
      canonicalize(JSON.parse(JSON.stringify({ memberSince: date }))),
    );
  });

  it("rejects non-plain objects without toJSON (no silent {} collapse)", () => {
    expect(() => canonicalize(new Map([["a", 1]]))).toThrow(/non-plain/);
    expect(() => canonicalize({ claims: new Set([1]) })).toThrow(/non-plain/);
    // Null-prototype objects are fine.
    expect(canonicalize(Object.assign(Object.create(null), { a: 1 }))).toBe('{"a":1}');
  });
});
