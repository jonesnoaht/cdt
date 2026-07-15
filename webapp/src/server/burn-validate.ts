/**
 * Validate that a Cardano transaction burns exactly one CDT for a deposit.
 *
 * Uses Koios `tx_info` (same provider as mint chain lookup). When no chain
 * provider is configured, lab mode can skip (`requireOnChain=false`).
 *
 * Checks (when on-chain validation is required):
 *  1. Transaction exists and is returned by the provider.
 *  2. A mint entry with negative quantity exists for the deposit asset name
 *     (UTF-8 deposit_id encoded as hex asset name, matching mint policy).
 *  3. If `policyId` is configured, the burn must be under that policy.
 *
 * This does not yet prove vault Redeemer semantics end-to-end — that needs
 * full redeemer/datum decoding. It *does* prevent accepting a random/unrelated
 * tx hash as BurnEvidence.
 */
import { explorerUrlFor } from "./cds.js";

export type BurnValidateMode = "off" | "soft" | "strict";

export interface BurnValidateParams {
  /** CHAIN_PROVIDER value; currently only "koios-preview" performs HTTP lookup. */
  provider: string | undefined;
  koiosBaseUrl: string;
  /** 64-char hex tx hash. */
  txHash: string;
  /** Bank deposit id / CDT asset name (plaintext string, e.g. "4" or "DEP-…"). */
  depositId: string;
  /** Optional mint policy id (hex). When set, burn must match this policy. */
  policyId?: string;
  /**
   * off    — never call chain; always ok (lab)
   * soft   — call chain when configured; on failure return ok with warning
   * strict — require successful on-chain burn match (production default when provider set)
   */
  mode: BurnValidateMode;
  fetchImpl?: typeof fetch;
}

export type BurnValidateResult =
  | {
      ok: true;
      mode: BurnValidateMode;
      onChain: boolean;
      provider?: string;
      explorerUrl?: string;
      burnedQuantity?: string;
      policyId?: string;
      assetNameHex?: string;
      warning?: string;
    }
  | {
      ok: false;
      mode: BurnValidateMode;
      reason: string;
      reasonCode:
        | "TX_NOT_FOUND"
        | "TX_INVALID"
        | "PROVIDER_ERROR"
        | "PROVIDER_UNCONFIGURED"
        | "BAD_TX_HASH";
    };

/** UTF-8 string → lowercase hex (Cardano native asset name encoding). */
export function assetNameHexFromText(text: string): string {
  return Buffer.from(text, "utf8").toString("hex");
}

export function burnValidateModeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BurnValidateMode {
  const raw = (env.BURN_VALIDATE_MODE || "").toLowerCase();
  if (raw === "off" || raw === "soft" || raw === "strict") return raw;
  // Production-ish default: if a chain provider is set, be strict; else off.
  if (env.CHAIN_PROVIDER === "koios-preview") return "strict";
  return "off";
}

interface KoiosMintEntry {
  policy_id?: string;
  asset_name?: string;
  quantity?: string | number;
}

interface KoiosTxInfo {
  tx_hash?: string;
  mint?: KoiosMintEntry[];
  assets_minted?: KoiosMintEntry[];
}

function mintEntries(tx: KoiosTxInfo): KoiosMintEntry[] {
  if (Array.isArray(tx.mint) && tx.mint.length > 0) return tx.mint;
  if (Array.isArray(tx.assets_minted) && tx.assets_minted.length > 0) {
    return tx.assets_minted;
  }
  return [];
}

function quantityNumber(q: string | number | undefined): number {
  if (typeof q === "number") return q;
  if (typeof q === "string") return Number(q);
  return 0;
}

/**
 * Find a burn of the deposit asset in Koios mint arrays (negative quantity).
 */
export function findCdtBurn(
  tx: KoiosTxInfo,
  depositId: string,
  policyId?: string,
): { policyId: string; assetNameHex: string; quantity: string } | null {
  const wantName = assetNameHexFromText(depositId).toLowerCase();
  // Also accept if depositId was already hex-encoded asset name.
  const wantNameAlt = depositId.toLowerCase().replace(/^0x/, "");
  for (const m of mintEntries(tx)) {
    const qty = quantityNumber(m.quantity);
    if (!(qty < 0)) continue;
    const name = (m.asset_name || "").toLowerCase();
    const pol = (m.policy_id || "").toLowerCase();
    const nameOk = name === wantName || name === wantNameAlt;
    if (!nameOk) continue;
    if (policyId && pol !== policyId.toLowerCase()) continue;
    return {
      policyId: pol,
      assetNameHex: name,
      quantity: String(m.quantity),
    };
  }
  return null;
}

export async function validateBurnTx(
  params: BurnValidateParams,
): Promise<BurnValidateResult> {
  const txHash = params.txHash.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(txHash)) {
    return {
      ok: false,
      mode: params.mode,
      reason: "txHash must be a 64-char hex Cardano transaction id.",
      reasonCode: "BAD_TX_HASH",
    };
  }

  if (params.mode === "off") {
    return {
      ok: true,
      mode: "off",
      onChain: false,
      warning: "On-chain burn validation disabled (BURN_VALIDATE_MODE=off).",
    };
  }

  if (params.provider !== "koios-preview") {
    if (params.mode === "strict") {
      return {
        ok: false,
        mode: "strict",
        reason:
          "Strict burn validation requires CHAIN_PROVIDER=koios-preview (or set BURN_VALIDATE_MODE=soft|off for lab).",
        reasonCode: "PROVIDER_UNCONFIGURED",
      };
    }
    return {
      ok: true,
      mode: params.mode,
      onChain: false,
      warning: "No chain provider configured; burn hash recorded without on-chain check.",
    };
  }

  const fetchImpl = params.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${params.koiosBaseUrl}/tx_info`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ _tx_hashes: [txHash] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const msg = `Koios responded ${res.status}.`;
      if (params.mode === "soft") {
        return {
          ok: true,
          mode: "soft",
          onChain: false,
          warning: msg,
        };
      }
      return {
        ok: false,
        mode: "strict",
        reason: msg,
        reasonCode: "PROVIDER_ERROR",
      };
    }
    const body = (await res.json()) as unknown;
    const rows = Array.isArray(body) ? (body as KoiosTxInfo[]) : [];
    const tx = rows[0];
    if (!tx) {
      if (params.mode === "soft") {
        return {
          ok: true,
          mode: "soft",
          onChain: false,
          warning: "Transaction not found on-chain (soft mode).",
        };
      }
      return {
        ok: false,
        mode: "strict",
        reason: "Transaction not found on-chain.",
        reasonCode: "TX_NOT_FOUND",
      };
    }

    const burn = findCdtBurn(tx, params.depositId, params.policyId);
    if (!burn) {
      const reason = params.policyId
        ? `No burn of CDT asset for deposit_id=${params.depositId} under policy ${params.policyId}.`
        : `No burn of CDT asset for deposit_id=${params.depositId} in transaction mint list.`;
      if (params.mode === "soft") {
        return {
          ok: true,
          mode: "soft",
          onChain: true,
          provider: "koios-preview",
          explorerUrl: explorerUrlFor(txHash),
          warning: reason,
        };
      }
      return {
        ok: false,
        mode: "strict",
        reason,
        reasonCode: "TX_INVALID",
      };
    }

    return {
      ok: true,
      mode: params.mode,
      onChain: true,
      provider: "koios-preview",
      explorerUrl: explorerUrlFor(txHash),
      burnedQuantity: burn.quantity,
      policyId: burn.policyId,
      assetNameHex: burn.assetNameHex,
    };
  } catch (err) {
    const msg = `On-chain burn lookup failed: ${String(err)}`;
    if (params.mode === "soft") {
      return { ok: true, mode: "soft", onChain: false, warning: msg };
    }
    return {
      ok: false,
      mode: "strict",
      reason: msg,
      reasonCode: "PROVIDER_ERROR",
    };
  }
}
