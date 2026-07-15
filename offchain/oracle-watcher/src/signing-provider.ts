/**
 * Pluggable signing for the mint oracle (and future HSM).
 *
 * Modes (env ORACLE_SIGNING_PROVIDER):
 *   pem   — default; load ORACLE_SIGNING_KEY_PEM (or ephemeral lab key)
 *   hsm   — stub; fails closed until PKCS#11 / cloud HSM is wired
 *
 * Callers use signUtf8Message(); public SPKI is for pins/logs only.
 */
import {
  createPublicKey,
  type KeyObject,
} from "node:crypto";
import {
  generateEd25519KeyPair,
  privateKeyFromPem,
  publicKeyToBase64,
  signUtf8,
} from "./keys.js";

export interface SigningProvider {
  readonly kind: "pem" | "hsm" | "ephemeral";
  /** Base64 SPKI DER — pin this, never the private material. */
  publicKeySpkiBase64(): string;
  /** Ed25519 sign over UTF-8 message → base64 signature. */
  signUtf8Message(message: string): Promise<string> | string;
  /** Optional raw KeyObject for APIs that still need it (pem/ephemeral only). */
  privateKeyObject?(): KeyObject;
}

export class PemSigningProvider implements SigningProvider {
  readonly kind = "pem" as const;
  private readonly privateKey: KeyObject;
  private readonly pubB64: string;

  constructor(privateKeyPem: string) {
    this.privateKey = privateKeyFromPem(privateKeyPem);
    this.pubB64 = publicKeyToBase64(createPublicKey(this.privateKey));
  }

  publicKeySpkiBase64(): string {
    return this.pubB64;
  }

  signUtf8Message(message: string): string {
    return signUtf8(message, this.privateKey);
  }

  privateKeyObject(): KeyObject {
    return this.privateKey;
  }
}

export class EphemeralSigningProvider implements SigningProvider {
  readonly kind = "ephemeral" as const;
  private readonly privateKey: KeyObject;
  private readonly pubB64: string;

  constructor() {
    const pair = generateEd25519KeyPair();
    this.privateKey = pair.privateKey;
    this.pubB64 = publicKeyToBase64(pair.publicKey);
  }

  publicKeySpkiBase64(): string {
    return this.pubB64;
  }

  signUtf8Message(message: string): string {
    return signUtf8(message, this.privateKey);
  }

  privateKeyObject(): KeyObject {
    return this.privateKey;
  }
}

/**
 * Placeholder for PKCS#11 / Cloud HSM / AWS KMS Ed25519.
 * Fail-closed until ORACLE_HSM_MODULE + key id are implemented.
 */
export class HsmSigningProvider implements SigningProvider {
  readonly kind = "hsm" as const;
  constructor(
    private readonly modulePath: string,
    private readonly keyId: string,
  ) {}

  publicKeySpkiBase64(): string {
    throw new Error(
      `HsmSigningProvider not implemented (module=${this.modulePath}, keyId=${this.keyId}). Wire PKCS#11 or cloud HSM.`,
    );
  }

  signUtf8Message(): never {
    throw new Error(
      `HsmSigningProvider.signUtf8Message not implemented (module=${this.modulePath}, keyId=${this.keyId}).`,
    );
  }
}

export function signingProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SigningProvider {
  const mode = (env.ORACLE_SIGNING_PROVIDER || "pem").toLowerCase();
  if (mode === "hsm") {
    const modulePath = env.ORACLE_HSM_MODULE || "";
    const keyId = env.ORACLE_HSM_KEY_ID || "";
    if (!modulePath || !keyId) {
      throw new Error(
        "ORACLE_SIGNING_PROVIDER=hsm requires ORACLE_HSM_MODULE and ORACLE_HSM_KEY_ID",
      );
    }
    return new HsmSigningProvider(modulePath, keyId);
  }
  const pem = env.ORACLE_SIGNING_KEY_PEM;
  if (pem) return new PemSigningProvider(pem);
  if (env.ALLOW_EPHEMERAL_ORACLE_KEY === "1") {
    return new EphemeralSigningProvider();
  }
  throw new Error(
    "ORACLE_SIGNING_KEY_PEM is required (or ALLOW_EPHEMERAL_ORACLE_KEY=1 for lab, or ORACLE_SIGNING_PROVIDER=hsm)",
  );
}
