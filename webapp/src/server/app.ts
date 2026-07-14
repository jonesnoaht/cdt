/**
 * API server for the CDT member portal. Reads the (simulated) core-banking
 * Postgres directly; writing a CD-funding deposit row is how a member "opens
 * a CD" — the oracle watcher / mint pipeline picks it up from there.
 */
import { Hono } from "hono";
import type pg from "pg";
import type {
  AccountDto,
  ChainLookupDto,
  DepositResponse,
  MemberDto,
  ProductDto,
} from "../shared/types.js";
import { chainLookup } from "./chain.js";
import { CDS_SQL, toCdDto, type CdRow } from "./cds.js";

export interface AppOptions {
  pool: pg.Pool;
  /** Clock override for tests (epoch ms). */
  now?: () => number;
  chainProvider?: string | undefined;
  koiosBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface MemberIdentity {
  memberName: string;
  walletAddress: string;
  did: string;
}

/** Resolve a member (identified by any of their account ids) or null. */
async function resolveMember(pool: pg.Pool, accountId: number): Promise<MemberIdentity | null> {
  const { rows } = await pool.query(
    `SELECT member_name, wallet_address, did FROM accounts WHERE id = $1`,
    [accountId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    memberName: row.member_name,
    walletAddress: row.wallet_address,
    did: row.did,
  };
}

function parseIdParam(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function createApp(options: AppOptions): Hono {
  const { pool } = options;
  const now = options.now ?? Date.now;
  const koiosBaseUrl = options.koiosBaseUrl ?? "https://preview.koios.rest/api/v1";

  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true }));

  // --- CD product catalog ---------------------------------------------------
  app.get("/api/products", async (c) => {
    const { rows } = await pool.query(
      `SELECT id, name, term_months, rate_bps, penalty_bps, min_deposit_cents
         FROM cd_products ORDER BY term_months, id`,
    );
    const products: ProductDto[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      termMonths: r.term_months,
      rateBps: r.rate_bps,
      apyPercent: r.rate_bps / 100,
      penaltyBps: r.penalty_bps,
      minDepositCents: Number(r.min_deposit_cents),
    }));
    return c.json(products);
  });

  // --- Members (demo login picker) ------------------------------------------
  app.get("/api/members", async (c) => {
    const { rows } = await pool.query(
      `SELECT min(id) AS id, member_name, wallet_address, did
         FROM accounts
        GROUP BY member_name, wallet_address, did
        ORDER BY min(id)`,
    );
    const members: MemberDto[] = rows.map((r) => ({
      id: Number(r.id),
      memberName: r.member_name,
      walletAddress: r.wallet_address,
      did: r.did,
    }));
    return c.json(members);
  });

  // --- Member accounts + balances -------------------------------------------
  app.get("/api/members/:id/accounts", async (c) => {
    const id = parseIdParam(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid member id." }, 400);
    const member = await resolveMember(pool, id);
    if (!member) return c.json({ error: "Member not found." }, 404);

    const { rows } = await pool.query(
      `SELECT a.id, a.member_name, a.wallet_address, a.did, a.kind, a.created_at,
              COALESCE(SUM(CASE WHEN t.kind = 'deposit' THEN t.amount_cents
                                WHEN t.kind = 'withdrawal' THEN -t.amount_cents
                                ELSE 0 END), 0) AS balance_cents
         FROM accounts a
         LEFT JOIN transactions t ON t.account_id = a.id
        WHERE a.wallet_address = $1 AND a.did = $2
        GROUP BY a.id
        ORDER BY a.id`,
      [member.walletAddress, member.did],
    );
    const accounts: AccountDto[] = rows.map((r) => ({
      id: r.id,
      memberName: r.member_name,
      walletAddress: r.wallet_address,
      did: r.did,
      kind: r.kind,
      balanceCents: Number(r.balance_cents),
      createdAt: new Date(r.created_at).toISOString(),
    }));
    return c.json(accounts);
  });

  // --- Member CDs (deposits joined with attestations) ------------------------
  app.get("/api/members/:id/cds", async (c) => {
    const id = parseIdParam(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid member id." }, 400);
    const member = await resolveMember(pool, id);
    if (!member) return c.json({ error: "Member not found." }, 404);

    const { rows } = await pool.query(CDS_SQL, [member.walletAddress, member.did]);
    return c.json(rows.map((row) => toCdDto(row as CdRow, now())));
  });

  // --- Open a CD --------------------------------------------------------------
  app.post("/api/members/:id/deposits", async (c) => {
    const id = parseIdParam(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid member id." }, 400);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be JSON." }, 400);
    }
    const { productId, amountCents } = (body ?? {}) as {
      productId?: unknown;
      amountCents?: unknown;
    };
    if (typeof productId !== "number" || !Number.isSafeInteger(productId) || productId <= 0) {
      return c.json({ error: "productId must be a positive integer." }, 400);
    }
    if (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
      return c.json({ error: "amountCents must be a positive integer number of cents." }, 400);
    }

    const member = await resolveMember(pool, id);
    if (!member) return c.json({ error: "Member not found." }, 404);

    const { rows: productRows } = await pool.query(
      `SELECT id, name, min_deposit_cents FROM cd_products WHERE id = $1`,
      [productId],
    );
    const product = productRows[0];
    if (!product) return c.json({ error: "CD product not found." }, 404);

    const minDeposit = Number(product.min_deposit_cents);
    if (amountCents < minDeposit) {
      return c.json(
        {
          error: `The minimum deposit for ${product.name} is $${(minDeposit / 100).toFixed(2)}.`,
        },
        422,
      );
    }

    const { rows: fundingRows } = await pool.query(
      `SELECT id FROM accounts
        WHERE wallet_address = $1 AND did = $2 AND kind = 'cd_funding'
        ORDER BY id LIMIT 1`,
      [member.walletAddress, member.did],
    );
    const funding = fundingRows[0];
    if (!funding) {
      return c.json({ error: "Member has no CD funding account." }, 409);
    }

    const { rows: inserted } = await pool.query(
      `INSERT INTO transactions (account_id, amount_cents, kind, product_id, memo)
       VALUES ($1, $2, 'deposit', $3, $4)
       RETURNING id`,
      [funding.id, amountCents, productId, `member portal: fund ${product.name}`],
    );
    const response: DepositResponse = {
      transactionId: inserted[0].id,
      accountId: funding.id,
      productId,
      amountCents,
      status: "pending",
    };
    return c.json(response, 201);
  });

  // --- Optional on-chain lookup ----------------------------------------------
  app.get("/api/cds/:depositId/chain", async (c) => {
    const raw = c.req.param("depositId");
    // deposit_id is the stringified bank transaction id; accept either form.
    const { rows } = await pool.query(
      `SELECT deposit_id, payload FROM attestations
        WHERE deposit_id = $1 OR transaction_id = $2
        LIMIT 1`,
      [raw, Number.isSafeInteger(Number(raw)) ? Number(raw) : -1],
    );
    const attestation = rows[0];
    let txHash: string | null = null;
    if (attestation) {
      const signed = attestation.payload as { tx_hash?: unknown; payload?: { tx_hash?: unknown } };
      const candidate = signed?.tx_hash ?? signed?.payload?.tx_hash;
      txHash = typeof candidate === "string" && candidate.length > 0 ? candidate : null;
    }
    const result: ChainLookupDto = attestation
      ? await chainLookup({
          provider: options.chainProvider,
          koiosBaseUrl,
          txHash,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        })
      : { available: false, reason: "Certificate is not attested yet." };
    return c.json(result);
  });

  return app;
}
