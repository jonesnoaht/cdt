/** Display formatting helpers (presentation only — no interest math here). */

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function money(cents: number): string {
  return usd.format(cents / 100);
}

export function date(ms: number | string): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export const DAY_MS = 86_400_000;

export function daysUntil(ms: number, nowMs = Date.now()): number {
  return Math.max(0, Math.ceil((ms - nowMs) / DAY_MS));
}

export function termLabel(months: number): string {
  if (months % 12 === 0 && months >= 12) {
    const years = months / 12;
    return years === 1 ? "1 year" : `${years} years`;
  }
  return `${months} months`;
}

export function percentFromBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** 0..1 progress of `now` through [start, end]. */
export function progress(start: number, end: number, nowMs = Date.now()): number {
  if (end <= start) return 1;
  return Math.min(1, Math.max(0, (nowMs - start) / (end - start)));
}

export function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash;
}
