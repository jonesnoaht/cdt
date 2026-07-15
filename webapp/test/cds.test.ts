/**
 * CD status / attestation payload shape tests (no DB).
 */
import { describe, expect, it } from "vitest";
import { extractAttestationTerms, toCdDto, type CdRow } from "../src/server/cds.js";

const baseRow = (): CdRow => ({
  id: 4,
  amount_cents: "50000",
  memo: "demo",
  created_at: new Date("2026-01-01T00:00:00Z"),
  product_id: 1,
  name: "6-Month Share Certificate",
  term_months: 6,
  rate_bps: 400,
  penalty_bps: 1000,
  min_deposit_cents: "50000",
  deposit_id: null,
  payload: null,
});

describe("extractAttestationTerms", () => {
  it("reads nested oracle envelope", () => {
    const terms = extractAttestationTerms({
      payload: { start: 1, maturity: 2, principal: 100 },
      signature: "x",
    });
    expect(terms?.start).toBe(1);
    expect(terms?.maturity).toBe(2);
  });

  it("reads flattened lab payload", () => {
    const terms = extractAttestationTerms({ start: 10, maturity: 20 });
    expect(terms?.start).toBe(10);
  });
});

describe("toCdDto attestation status", () => {
  it("is pending without attestation row", () => {
    const dto = toCdDto(baseRow(), Date.parse("2026-03-01T00:00:00Z"));
    expect(dto.status).toBe("pending");
    expect(dto.startMs).toBeNull();
  });

  it("is active with nested start/maturity in the future", () => {
    const start = Date.parse("2026-01-01T00:00:00Z");
    const maturity = Date.parse("2026-07-01T00:00:00Z");
    const row = baseRow();
    row.deposit_id = "4";
    row.payload = {
      payload: {
        start,
        maturity,
        principal: 500_000_000,
        rate_bps: 400,
        penalty_bps: 1000,
      },
    };
    const dto = toCdDto(row, Date.parse("2026-03-01T00:00:00Z"));
    expect(dto.status).toBe("active");
    expect(dto.startMs).toBe(start);
    expect(dto.maturityMs).toBe(maturity);
    expect(dto.projectionEstimated).toBe(false);
  });

  it("is matured when now past maturity", () => {
    const start = Date.parse("2024-01-01T00:00:00Z");
    const maturity = Date.parse("2024-07-01T00:00:00Z");
    const row = baseRow();
    row.deposit_id = "4";
    row.payload = { payload: { start, maturity, principal: 500_000_000 } };
    const dto = toCdDto(row, Date.parse("2026-03-01T00:00:00Z"));
    expect(dto.status).toBe("matured");
  });

  it("falls back to product schedule when deposit_id set but no start/maturity", () => {
    const row = baseRow();
    row.deposit_id = "4";
    row.payload = { schema: "cdt.attestation.v2", deposit_id: "4" };
    const dto = toCdDto(row, Date.parse("2026-03-01T00:00:00Z"));
    expect(dto.status).toBe("active");
    expect(dto.startMs).not.toBeNull();
    expect(dto.projectionEstimated).toBe(true);
  });
});
