import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from 'node:crypto';

/** Ed25519 key pair used by the oracle (and by mock VC identities). */
export interface Ed25519KeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
}

export function generateEd25519KeyPair(): Ed25519KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicKey };
}

/** Load an Ed25519 private key from a PKCS#8 PEM string (e.g. from env/config). */
export function privateKeyFromPem(pem: string): KeyObject {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`expected an Ed25519 private key, got ${key.asymmetricKeyType}`);
  }
  return key;
}

export function privateKeyToPem(key: KeyObject): string {
  return key.export({ format: 'pem', type: 'pkcs8' }).toString();
}

/** Export a public key as base64-encoded SPKI DER (the wire form used in payloads). */
export function publicKeyToBase64(key: KeyObject): string {
  return key.export({ format: 'der', type: 'spki' }).toString('base64');
}

export function publicKeyFromBase64(b64: string): KeyObject {
  const key = createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
  // Fail closed on algorithm confusion: edVerify(null, ...) would otherwise
  // accept any EdDSA-family key (e.g. Ed448) supplied by an attacker.
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`expected an Ed25519 public key, got ${key.asymmetricKeyType}`);
  }
  return key;
}

/** Ed25519-sign a UTF-8 message; returns the signature base64-encoded. */
export function signUtf8(message: string, privateKey: KeyObject): string {
  return edSign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64');
}

/** Verify an Ed25519 signature (base64) over a UTF-8 message. */
export function verifyUtf8(message: string, signatureB64: string, publicKey: KeyObject): boolean {
  try {
    return edVerify(null, Buffer.from(message, 'utf8'), publicKey, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}
