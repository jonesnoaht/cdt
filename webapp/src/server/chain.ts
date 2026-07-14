/**
 * Optional on-chain lookup. The portal is fully functional offline; when
 * CHAIN_PROVIDER=koios-preview is configured, GET /api/cds/:depositId/chain
 * resolves the attestation's mint transaction via the Koios preview API.
 * Every failure mode degrades to { available: false } — never a 5xx.
 */
import type { ChainLookupDto } from "../shared/types.js";
import { explorerUrlFor } from "./cds.js";

export interface ChainLookupParams {
  provider: string | undefined;
  koiosBaseUrl: string;
  txHash: string | null;
  fetchImpl?: typeof fetch;
}

export async function chainLookup(params: ChainLookupParams): Promise<ChainLookupDto> {
  const { provider, koiosBaseUrl, txHash } = params;
  if (provider !== "koios-preview") {
    return {
      available: false,
      reason: "On-chain lookup is not configured (set CHAIN_PROVIDER=koios-preview).",
    };
  }
  if (!txHash) {
    return {
      available: false,
      reason: "No mint transaction hash recorded for this certificate yet.",
    };
  }
  const fetchImpl = params.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${koiosBaseUrl}/tx_info`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ _tx_hashes: [txHash] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { available: false, reason: `Koios responded ${res.status}.` };
    }
    const body = (await res.json()) as unknown[];
    return {
      available: true,
      provider: "koios-preview",
      txHash,
      explorerUrl: explorerUrlFor(txHash),
      tx: Array.isArray(body) ? (body[0] ?? null) : null,
    };
  } catch (err) {
    return { available: false, reason: `On-chain lookup failed: ${String(err)}` };
  }
}
