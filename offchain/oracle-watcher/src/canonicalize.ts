/**
 * Deterministic JSON canonicalization: object keys are emitted in sorted
 * order at every nesting level, `undefined`-valued keys are dropped, and no
 * insignificant whitespace is produced. Both the mock VC verifier and the
 * oracle attestation signer sign/verify over this canonical form so that
 * signatures are stable regardless of property insertion order.
 */
export function canonicalize(value: unknown): string {
  if (value === undefined) {
    throw new TypeError('cannot canonicalize undefined');
  }
  if (value === null || typeof value !== 'object') {
    const out = JSON.stringify(value);
    if (out === undefined) {
      throw new TypeError(`cannot canonicalize value of type ${typeof value}`);
    }
    return out;
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v === undefined ? null : v)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .filter((k) => record[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalize(record[k])}`);
  return `{${entries.join(',')}}`;
}
