/**
 * CIP-30 browser wallet bridge helpers (Lace-first).
 *
 * Lace, Eternl, Nami, etc. inject `window.cardano.<name>` and expose
 * `enable()` → API with `signTx(cbor, partialSign?)`.
 *
 * @see https://cips.cardano.org/cip/CIP-30
 * @see https://www.lace.io/faq (Lace DApp Connector / CIP-30)
 */

export type Cip30WalletName =
  | "lace"
  | "eternl"
  | "nami"
  | "typhoncip30"
  | "typhon"
  | "vespr"
  | "gerowallet"
  | "flint"
  | string;

export interface Cip30WalletApi {
  getNetworkId(): Promise<number>;
  getUsedAddresses(): Promise<string[]>;
  getUnusedAddresses(): Promise<string[]>;
  getChangeAddress(): Promise<string>;
  getRewardAddresses(): Promise<string[]>;
  getUtxos(amount?: string, paginate?: unknown): Promise<string[] | undefined>;
  getBalance(): Promise<string>;
  signTx(tx: string, partialSign?: boolean): Promise<string>;
  signData(addr: string, payload: string): Promise<{ signature: string; key: string }>;
  submitTx(tx: string): Promise<string>;
  getCollateral?(params?: { amount?: string }): Promise<string[] | undefined>;
}

export interface Cip30WalletPlugin {
  name?: string;
  icon?: string;
  apiVersion?: string;
  enable(): Promise<Cip30WalletApi>;
  isEnabled(): Promise<boolean>;
  experimental?: unknown;
}

export interface DetectedWallet {
  id: Cip30WalletName;
  label: string;
  plugin: Cip30WalletPlugin;
  /** Prefer Lace when multiple wallets are installed. */
  preferred: boolean;
}

declare global {
  interface Window {
    cardano?: Record<string, Cip30WalletPlugin | undefined>;
  }
}

const LABELS: Record<string, string> = {
  lace: "Lace",
  eternl: "Eternl",
  nami: "Nami",
  typhoncip30: "Typhon",
  typhon: "Typhon",
  vespr: "VESPR",
  gerowallet: "GeroWallet",
  flint: "Flint",
};

/** Stable preference order — Lace first. */
export const CIP30_PREFERENCE: string[] = [
  "lace",
  "eternl",
  "nami",
  "typhoncip30",
  "typhon",
  "vespr",
  "gerowallet",
  "flint",
];

function isPlugin(v: unknown): v is Cip30WalletPlugin {
  if (!v || typeof v !== "object") return false;
  const p = v as Cip30WalletPlugin;
  return typeof p.enable === "function" && typeof p.isEnabled === "function";
}

/**
 * List CIP-30 wallets currently injected on `window.cardano`.
 * Lace is sorted first when present.
 */
export function detectCip30Wallets(
  cardano: Record<string, Cip30WalletPlugin | undefined> | undefined = typeof window !== "undefined"
    ? window.cardano
    : undefined,
): DetectedWallet[] {
  if (!cardano) return [];
  const found: DetectedWallet[] = [];
  for (const [id, plugin] of Object.entries(cardano)) {
    if (!isPlugin(plugin)) continue;
    // Skip non-wallet experimental keys some injectors add
    if (id === "enable" || id === "nami" && !plugin) continue;
    found.push({
      id,
      label: LABELS[id] ?? plugin.name ?? id,
      plugin,
      preferred: id === "lace",
    });
  }
  found.sort((a, b) => {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    const ia = CIP30_PREFERENCE.indexOf(a.id);
    const ib = CIP30_PREFERENCE.indexOf(b.id);
    const ra = ia === -1 ? 999 : ia;
    const rb = ib === -1 ? 999 : ib;
    if (ra !== rb) return ra - rb;
    return a.id.localeCompare(b.id);
  });
  return found;
}

export function findLace(
  cardano?: Record<string, Cip30WalletPlugin | undefined>,
): DetectedWallet | undefined {
  return detectCip30Wallets(cardano).find((w) => w.id === "lace");
}

export function normalizeCborHex(hex: string): string {
  const h = hex.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]*$/.test(h) || h.length % 2 !== 0 || h.length < 2) {
    throw new Error("Transaction CBOR must be even-length hex");
  }
  return h;
}

export type SignWithWalletResult =
  | {
      ok: true;
      walletId: string;
      networkId: number;
      /** CIP-30 witness set CBOR hex from signTx. */
      witnessCborHex: string;
      changeAddress?: string;
    }
  | { ok: false; reason: string; code?: string };

/**
 * Connect to a CIP-30 wallet (default: Lace if available) and sign unsigned tx CBOR.
 *
 * partialSign=true is appropriate for multi-party / oracle co-sign flows.
 */
export async function signTxWithCip30(opts: {
  cborHex: string;
  /** Prefer this wallet id; falls back to Lace then first detected. */
  walletId?: string;
  partialSign?: boolean;
  cardano?: Record<string, Cip30WalletPlugin | undefined>;
}): Promise<SignWithWalletResult> {
  try {
    const wallets = detectCip30Wallets(opts.cardano);
    if (wallets.length === 0) {
      return {
        ok: false,
        reason:
          "No CIP-30 wallet found. Install Lace (chrome extension or mobile browser) and refresh this page.",
        code: "NO_WALLET",
      };
    }
    const pick =
      (opts.walletId
        ? wallets.find((w) => w.id === opts.walletId)
        : undefined) ??
      wallets.find((w) => w.id === "lace") ??
      wallets[0];
    if (!pick) {
      return { ok: false, reason: "Requested wallet not available.", code: "WALLET_MISSING" };
    }

    const api = await pick.plugin.enable();
    const cbor = normalizeCborHex(opts.cborHex);
    const networkId = await api.getNetworkId();
    const partial = opts.partialSign !== false; // default true for CDT multi-sig safety
    const witnessCborHex = await api.signTx(cbor, partial);
    const result: SignWithWalletResult = {
      ok: true,
      walletId: pick.id,
      networkId,
      witnessCborHex: normalizeCborHex(witnessCborHex),
    };
    try {
      const changeAddress = await api.getChangeAddress();
      if (changeAddress) {
        return { ...result, changeAddress };
      }
    } catch {
      // optional
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // CIP-30 user declined / TxSignError
    if (/refus|denied|cancel|user/i.test(msg)) {
      return { ok: false, reason: `Wallet declined to sign: ${msg}`, code: "USER_DECLINED" };
    }
    return { ok: false, reason: `CIP-30 signTx failed: ${msg}`, code: "SIGN_ERROR" };
  }
}
