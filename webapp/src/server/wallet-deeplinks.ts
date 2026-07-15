/**
 * Cardano mobile wallet deep-link templates for sign requests.
 *
 * There is no single universal Cardano URI for all wallets. We encode:
 *   1. claimUrl  — always works (open in mobile browser / PWA)
 *   2. deepLink  — wallet-specific scheme when known
 *
 * Bluetooth is not used. Prefer claim URL in QR; deep links as optional buttons.
 *
 * Brands are best-effort; schemes evolve — operators should pin tested URIs.
 */

export type WalletBrand =
  | "claim_url"
  | "eternl"
  | "vespr"
  | "lace"
  | "nami"
  | "typhon"
  | "generic_cardano";

export interface DeepLinkOption {
  brand: WalletBrand;
  label: string;
  /** Fully resolved URL, or null if not applicable. */
  url: string | null;
  notes?: string;
}

/**
 * Build deep-link options for a sign-request claim URL.
 * `{url}` is replaced with encodeURIComponent(claimUrl).
 */
export function buildWalletDeepLinks(claimUrl: string): DeepLinkOption[] {
  const enc = encodeURIComponent(claimUrl);
  return [
    {
      brand: "claim_url",
      label: "Open claim page (any browser)",
      url: claimUrl,
      notes: "Recommended in QR — wallet-agnostic.",
    },
    {
      brand: "eternl",
      label: "Eternl",
      // Eternl dApp connector is primarily browser-extension; mobile uses browser tab.
      url: claimUrl,
      notes: "Open claim page in Safari/Chrome; connect Eternl if available.",
    },
    {
      brand: "vespr",
      label: "VESPR",
      url: `https://vespr.xyz/browse?url=${enc}`,
      notes: "VESPR in-app browser entry (may change with app version).",
    },
    {
      brand: "lace",
      label: "Lace",
      url: claimUrl,
      notes: "Use mobile browser + Lace if installed; no stable public deep-link API yet.",
    },
    {
      brand: "nami",
      label: "Nami",
      url: claimUrl,
      notes: "Extension-first; mobile support limited.",
    },
    {
      brand: "typhon",
      label: "Typhon",
      url: claimUrl,
      notes: "Prefer claim page; confirm scheme with current Typhon docs.",
    },
    {
      brand: "generic_cardano",
      label: "Generic cardano: URI",
      // Some experimental handlers accept a callback URL payload.
      url: `web+cardano://dapp?url=${enc}`,
      notes: "Experimental; not all OS handlers registered.",
    },
  ];
}

/** Single template string for SignRequestStore.deepLinkTemplate. */
export function deepLinkTemplateForBrand(brand: WalletBrand): string | undefined {
  switch (brand) {
    case "vespr":
      return "https://vespr.xyz/browse?url={url}";
    case "generic_cardano":
      return "web+cardano://dapp?url={url}";
    case "claim_url":
    case "eternl":
    case "lace":
    case "nami":
    case "typhon":
    default:
      return undefined; // claim URL only
  }
}

export function listWalletBrands(): Array<{ brand: WalletBrand; label: string }> {
  return [
    { brand: "claim_url", label: "Claim URL only (recommended QR)" },
    { brand: "vespr", label: "VESPR browse" },
    { brand: "generic_cardano", label: "web+cardano experimental" },
    { brand: "eternl", label: "Eternl (claim page)" },
    { brand: "lace", label: "Lace (claim page)" },
    { brand: "nami", label: "Nami (claim page)" },
    { brand: "typhon", label: "Typhon (claim page)" },
  ];
}
