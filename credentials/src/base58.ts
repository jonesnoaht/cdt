/**
 * Vendored base58btc (Bitcoin alphabet) encoder/decoder.
 *
 * Kept in-source so the package has zero runtime dependencies. The inputs we
 * handle (34-byte multicodec public keys, 64-byte Ed25519 signatures) are
 * small, so a BigInt implementation is simple and fast enough.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const CHAR_TO_VALUE = new Map<string, bigint>(
  [...ALPHABET].map((char, index) => [char, BigInt(index)]),
);

/** Encode bytes as a base58btc string (no multibase prefix). */
export function base58btcEncode(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }

  let encoded = "";
  while (value > 0n) {
    encoded = ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }

  // Each leading zero byte is encoded as the first alphabet character ("1").
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) {
    leadingZeros += 1;
  }

  return "1".repeat(leadingZeros) + encoded;
}

/** Decode a base58btc string (no multibase prefix) back into bytes. */
export function base58btcDecode(input: string): Uint8Array {
  let value = 0n;
  for (const char of input) {
    const digit = CHAR_TO_VALUE.get(char);
    if (digit === undefined) {
      throw new Error(`invalid base58btc character: ${JSON.stringify(char)}`);
    }
    value = value * 58n + digit;
  }

  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }

  let leadingOnes = 0;
  while (leadingOnes < input.length && input[leadingOnes] === "1") {
    leadingOnes += 1;
  }

  return Uint8Array.from([...new Array<number>(leadingOnes).fill(0), ...bytes]);
}
