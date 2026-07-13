/**
 * Deterministic JSON canonicalization: JSON.stringify with recursively sorted
 * object keys. Two structurally-equal documents always canonicalize to the
 * same string regardless of key insertion order, which makes the string a
 * stable signing payload.
 *
 * (A production system would use RDF Dataset Canonicalization / JCS as
 * required by the proof suite; this is the mock equivalent.)
 */
export function canonicalize(value: unknown): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error("cannot canonicalize non-finite number");
      }
      return JSON.stringify(value);
    default:
      break;
  }

  if (Array.isArray(value)) {
    // Match JSON.stringify: undefined array elements serialize as null.
    return `[${value.map((item) => canonicalize(item === undefined ? null : item)).join(",")}]`;
  }

  if (typeof value === "object") {
    // Match JSON.stringify: honor toJSON (e.g. Date -> ISO string), so the
    // canonical form is identical before and after a JSON round-trip.
    const withToJson = value as { toJSON?: () => unknown };
    if (typeof withToJson.toJSON === "function") {
      return canonicalize(withToJson.toJSON());
    }
    // Reject other non-plain objects (Map, Set, class instances): they would
    // all collapse to "{}", letting distinct documents share one signature.
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error("cannot canonicalize non-plain object");
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const body = entries
      .map(([key, v]) => `${JSON.stringify(key)}:${canonicalize(v)}`)
      .join(",");
    return `{${body}}`;
  }

  throw new Error(`cannot canonicalize value of type ${typeof value}`);
}
