/**
 * Pluggable signing for the mint oracle (and future HSM).
 *
 * Modes (env ORACLE_SIGNING_PROVIDER):
 *   pem      — default; load ORACLE_SIGNING_KEY_PEM (or ephemeral lab key)
 *   remote   — HTTP remote signer (HSM sidecar / enclave bridge)
 *   hsm      — PKCS#11 path; fails closed until native module is wired
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
  readonly kind: "pem" | "hsm" | "ephemeral" | "remote";
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
 * HTTP remote signer — production shape for an HSM sidecar / signing enclave.
 *
 * Protocol (POST ORACLE_REMOTE_SIGNER_URL):
 *   request:  { "message": "<utf8 string>" }
 *   response: { "signature": "<base64>", "publicKeySpkiBase64": "<base64>" }
 *
 * Optional Authorization: Bearer ORACLE_REMOTE_SIGNER_TOKEN
 */
export class RemoteSigningProvider implements SigningProvider {
  readonly kind = "remote" as const;
  private readonly url: string;
  private readonly token?: string;
  private readonly pinnedPub?: string;
  private readonly fetchImpl: typeof fetch;
  private cachedPub?: string;

  constructor(opts: {
    url: string;
    token?: string;
    publicKeySpkiBase64?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.url = opts.url;
    this.token = opts.token;
    this.pinnedPub = opts.publicKeySpkiBase64;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  publicKeySpkiBase64(): string {
    if (this.pinnedPub) return this.pinnedPub;
    if (this.cachedPub) return this.cachedPub;
    throw new Error(
      "RemoteSigningProvider: pin ORACLE_REMOTE_SIGNER_PUBKEY_SPKI or sign once to learn public key",
    );
  }

  async signUtf8Message(message: string): Promise<string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `RemoteSigningProvider: signer HTTP ${res.status} ${text.slice(0, 200)}`,
      );
    }
    const body = (await res.json()) as {
      signature?: string;
      publicKeySpkiBase64?: string;
    };
    if (!body.signature || typeof body.signature !== "string") {
      throw new Error("RemoteSigningProvider: response missing signature");
    }
    if (body.publicKeySpkiBase64) {
      if (this.pinnedPub && body.publicKeySpkiBase64 !== this.pinnedPub) {
        throw new Error(
          "RemoteSigningProvider: signer public key does not match pin",
        );
      }
      this.cachedPub = body.publicKeySpkiBase64;
    }
    return body.signature;
  }
}

/**
 * PKCS#11 / Cloud HSM path — fails closed until a native module is linked.
 * Prefer ORACLE_SIGNING_PROVIDER=remote for HSM sidecars in the meantime.
 */
export class HsmSigningProvider implements SigningProvider {
  readonly kind = "hsm" as const;
  constructor(
    private readonly modulePath: string,
    private readonly keyId: string,
  ) {}

  publicKeySpkiBase64(): string {
    throw new Error(
      `HsmSigningProvider not implemented (module=${this.modulePath}, keyId=${this.keyId}). ` +
        `Use ORACLE_SIGNING_PROVIDER=remote for an HSM sidecar, or wire PKCS#11.`,
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
  if (mode === "remote") {
    const url = env.ORACLE_REMOTE_SIGNER_URL || "";
    if (!url) {
      throw new Error(
        "ORACLE_SIGNING_PROVIDER=remote requires ORACLE_REMOTE_SIGNER_URL",
      );
    }
    return new RemoteSigningProvider({
      url,
      token: env.ORACLE_REMOTE_SIGNER_TOKEN,
      publicKeySpkiBase64: env.ORACLE_REMOTE_SIGNER_PUBKEY_SPKI,
    });
  }
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
    "ORACLE_SIGNING_KEY_PEM is required (or ALLOW_EPHEMERAL_ORACLE_KEY=1 for lab, or ORACLE_SIGNING_PROVIDER=remote|hsm)",
  );
}
