/** Small formatting helpers shared by the CLIs. */

/** Render lovelace as an ADA amount, e.g. `1234.567890 ADA`. */
export function ada(lovelace: bigint | string | number): string {
  const v = BigInt(lovelace);
  const abs = v < 0n ? -v : v;
  const sign = v < 0n ? "-" : "";
  const whole = abs / 1_000_000n;
  const frac = abs % 1_000_000n;
  return `${sign}${whole}.${frac.toString().padStart(6, "0")} ADA`;
}

export function shortHash(hash: string | null, length = 12): string {
  if (!hash) return "—";
  return hash.length <= length ? hash : `${hash.slice(0, length)}…`;
}

export function tsToIso(ms: number | string | bigint): string {
  const n = Number(ms);
  return n > 0 ? new Date(n).toISOString().replace(".000Z", "Z") : "—";
}

/** Pad-based plain-text table. */
export function renderTable(header: string[], rows: string[][]): string {
  const all = [header, ...rows];
  const widths = header.map((_, i) =>
    Math.max(...all.map((r) => (r[i] ?? "").length)),
  );
  const line = (r: string[]): string =>
    r.map((cell, i) => (cell ?? "").padEnd(widths[i] ?? 0)).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  return [line(header), separator, ...rows.map(line)].join("\n");
}
