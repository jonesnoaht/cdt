/**
 * Correspondent presentment: a non-issuing credit union looks up a foreign
 * CDT claim, quotes cash-out, advances cash to a walk-in customer, and files
 * settlement against the issuing CU.
 *
 * Presentments are held in process memory for the demo (no new bank-sim
 * tables). Restarting the API clears them.
 */
import type pg from "pg";
import type {
  CdDto,
  ClaimLookupDto,
  PresentmentDto,
  PresentmentRequest,
} from "../shared/types.js";
import { toCdDto, type CdRow } from "./cds.js";

const ISSUER_NAME = "CampusUSA Credit Union";
const PRESENTING_DEFAULT = "Gulfside Credit Union";

export interface ClaimRow extends CdRow {
  member_name: string;
  wallet_address: string;
  did: string;
  attested_flag: boolean;
}

const CLAIM_SQL = `
  SELECT t.id, t.amount_cents, t.memo, t.created_at, t.attested AS attested_flag,
         p.id AS product_id, p.name, p.term_months, p.rate_bps, p.penalty_bps,
         p.min_deposit_cents,
         att.deposit_id, att.payload,
         a.member_name, a.wallet_address, a.did
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN cd_products p ON p.id = t.product_id
    LEFT JOIN attestations att ON att.transaction_id = t.id
   WHERE t.kind = 'deposit'
     AND t.product_id IS NOT NULL
     AND (
       att.deposit_id = $1
       OR t.id::text = $1
       OR ($2::bigint IS NOT NULL AND t.id = $2)
     )
   ORDER BY t.id DESC
   LIMIT 1
`;

export function parseClaimRef(raw: string): { ref: string; asNumber: number | null } {
  const ref = raw.trim();
  const n = Number(ref);
  const asNumber = Number.isSafeInteger(n) && n > 0 ? n : null;
  return { ref, asNumber };
}

export async function lookupClaim(
  pool: pg.Pool,
  rawRef: string,
  nowMs: number,
): Promise<ClaimLookupDto | null> {
  const { ref, asNumber } = parseClaimRef(rawRef);
  if (!ref) return null;
  const { rows } = await pool.query(CLAIM_SQL, [ref, asNumber]);
  const row = rows[0] as ClaimRow | undefined;
  if (!row) return null;

  const cd = toCdDto(row, nowMs, false);
  const redeemable = cd.status === "active" || cd.status === "matured";
  const cashOutCents =
    cd.status === "matured" ? cd.maturityValueCents : cd.earlyPayoutTodayCents;

  return {
    claim: cd,
    issuerName: ISSUER_NAME,
    holderName: row.member_name,
    holderDid: row.did,
    holderWallet: row.wallet_address,
    redeemable,
    cashOutMode: cd.status === "matured" ? "mature" : cd.status === "active" ? "early" : "not_ready",
    cashOutCents: redeemable ? cashOutCents : null,
    notes: buildClaimNotes(cd),
  };
}

function buildClaimNotes(cd: CdDto): string[] {
  const notes: string[] = [];
  if (cd.status === "pending") {
    notes.push(
      "This deposit is not yet attested by the issuing credit union's oracle. Do not advance cash.",
    );
  }
  if (cd.status === "active") {
    notes.push(
      "Certificate is still in term. Cash-out uses early-withdrawal math (principal + accrued − penalty). Confirm the holder accepts the penalty before advancing funds.",
    );
  }
  if (cd.status === "matured") {
    notes.push(
      "Certificate is at or past maturity. Cash-out is principal + full contractual interest.",
    );
  }
  if (!cd.txHash) {
    notes.push(
      "No mint transaction hash is recorded yet. Prefer waiting for a tokenized (minted) claim, or settle only against issuer core confirmation.",
    );
  }
  notes.push(
    "You are not the issuer. Advancing cash creates a correspondent receivable against the issuing CU — the vault burn/redeem still requires the holder's key and the issuer's program rules.",
  );
  notes.push(
    "The insured deposit claim lives on the issuer's books (NCUSIF). Your advance is an uninsured inter-CU receivable until the issuer settles.",
  );
  return notes;
}

/** In-memory presentment ledger for the demo API process. */
export class PresentmentStore {
  private seq = 1;
  private byId = new Map<number, PresentmentDto>();
  /** depositId/transactionId → presentment ids (prevent double cash-out demo). */
  private byClaim = new Map<string, number[]>();

  list(): PresentmentDto[] {
    return [...this.byId.values()].sort((a, b) => b.id - a.id);
  }

  get(id: number): PresentmentDto | undefined {
    return this.byId.get(id);
  }

  findOpenForClaim(claimKey: string): PresentmentDto | undefined {
    const ids = this.byClaim.get(claimKey) ?? [];
    for (const id of ids) {
      const p = this.byId.get(id);
      if (p && p.status !== "rejected") return p;
    }
    return undefined;
  }

  create(input: {
    claim: ClaimLookupDto;
    body: PresentmentRequest;
    nowMs: number;
  }): PresentmentDto | { error: string; status: number } {
    const { claim, body, nowMs } = input;
    if (!claim.redeemable || claim.cashOutCents === null) {
      return {
        error: "Claim is not redeemable for cash at this desk (pending or unattested).",
        status: 422,
      };
    }
    if (!body.checks?.cip || !body.checks?.ofac || !body.checks?.ownershipProof) {
      return {
        error: "CIP, OFAC, and ownership-proof checks must all be confirmed.",
        status: 422,
      };
    }
    if (!body.walkInName || typeof body.walkInName !== "string" || !body.walkInName.trim()) {
      return { error: "walkInName is required.", status: 400 };
    }
    const presentingCu =
      typeof body.presentingCuName === "string" && body.presentingCuName.trim()
        ? body.presentingCuName.trim()
        : PRESENTING_DEFAULT;

    const claimKey = claim.claim.depositId ?? String(claim.claim.transactionId);
    const existing = this.findOpenForClaim(claimKey);
    if (existing) {
      return {
        error: `An open presentment (#${existing.id}) already exists for this claim.`,
        status: 409,
      };
    }

    // Walk-in must match holder for the demo (correspondent verifies identity).
    const walkIn = body.walkInName.trim();
    if (walkIn.toLowerCase() !== claim.holderName.toLowerCase()) {
      return {
        error: `Walk-in name must match the certificate holder on the issuer's books (${claim.holderName}).`,
        status: 422,
      };
    }

    const mode = claim.cashOutMode === "mature" ? "mature" : "early";
    const id = this.seq++;
    const dto: PresentmentDto = {
      id,
      createdAt: new Date(nowMs).toISOString(),
      status: "pending_burn",
      presentingCuName: presentingCu,
      issuerName: claim.issuerName,
      walkInName: walkIn,
      transactionId: claim.claim.transactionId,
      depositId: claim.claim.depositId,
      principalCents: claim.claim.principalCents,
      cashOutCents: claim.cashOutCents,
      cashOutMode: mode,
      productName: claim.claim.product.name,
      rateBps: claim.claim.rateBps,
      holderDid: claim.holderDid,
      holderWallet: claim.holderWallet,
      settlement:
        mode === "mature"
          ? `HOLD FUNDS until burn. Mature settlement of $${(claim.cashOutCents / 100).toFixed(2)} from ${claim.issuerName} against deposit ${claimKey}. Holder co-signs vault Redeem / burn CDT; issuer wires to ${presentingCu}.`
          : `HOLD FUNDS until burn. Early-withdrawal settlement of $${(claim.cashOutCents / 100).toFixed(2)} (penalty applied) from ${claim.issuerName} against deposit ${claimKey}. Holder co-signs EarlyWithdraw + burn; issuer settles net to ${presentingCu}.`,
      nextSteps: [
        "Do NOT advance unrestricted cash yet — place hold or wait for burn.",
        "Obtain holder wallet signature for Redeem or EarlyWithdraw (or issuer recovery path).",
        "Submit burn tx hash to issuer; wait for BurnAccepted + core close.",
        "Only then release credit / cash; file settlement claim with presentment id.",
      ],
      settlementInstructions: [
        "DO NOT advance unrestricted cash until burn evidence is accepted.",
        `1. Obtain holder co-signature for ${mode === "mature" ? "Redeem" : "EarlyWithdraw"} (burn CDT ${claim.claim.depositId ?? claim.claim.transactionId}).`,
        "2. Submit burn tx hash to the issuer; wait for BurnAccepted.",
        `3. Issuer closes deposit on core and settles ${claim.cashOutCents} cents to ${presentingCu}.`,
        "4. Only then post final share-credit to the walk-in (or release hold).",
        "NCUSIF coverage remains with the issuing CU until the certificate is closed on its books.",
      ].join("\n"),
    };
    this.byId.set(id, dto);
    const list = this.byClaim.get(claimKey) ?? [];
    list.push(id);
    this.byClaim.set(claimKey, list);
    return dto;
  }
}

export const defaultPresentingCu = PRESENTING_DEFAULT;
export const defaultIssuerName = ISSUER_NAME;
