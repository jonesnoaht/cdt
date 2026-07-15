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
  PresentmentDto,
  PresentmentRequest,
  ProductDto,
  TokenizePrepDto,
  ClaimLookupDto,
  PaymentVerifyRequest,
  SignedPaymentCheck,
} from "../shared/types.js";
import { chainLookup } from "./chain.js";
import { CDS_SQL, productDtoFromRow, toCdDto, type CdRow } from "./cds.js";
import {
  PresentmentStore,
  defaultPresentingCu,
  defaultIssuerName,
  lookupClaim,
} from "./presentments.js";
import { DepositRegistry } from "./deposit-registry.js";
import { PaymentOracle } from "./payment-oracle.js";
import { SignRequestStore } from "./sign-requests.js";
import {
  identityProviderFromEnv,
  type IdentityProvider,
  type IdvCheckRequest,
} from "./identity-provider.js";
import { listWalletBrands } from "./wallet-deeplinks.js";
import {
  isPublicPath,
  publicOrAuthed,
  publicOrRoleAuthed,
  rateLimit,
  securityHeaders,
  settlementRoleForPath,
  credentialGrantsRole,
  type RoleKeys,
} from "./security.js";

/**
 * Largest deposit (in cents) whose lovelace representation still fits in a
 * safe integer — the oracle watcher rejects anything larger when building
 * the attestation payload, which would leave the deposit pending forever.
 */
const MAX_DEPOSIT_CENTS = Math.floor(Number.MAX_SAFE_INTEGER / 10_000);

/** Standard NCUSIF SMSIA — used for desk disclosures, not a hard cap. */
const INSURANCE_LIMIT_CENTS = 250_000_00;

const TOKENIZE_CHECKS: TokenizePrepDto["checks"] = [
  {
    id: "membership",
    label: "Membership eligibility confirmed",
    detail: "Member is within the credit union field of membership.",
  },
  {
    id: "cip",
    label: "CIP / KYC complete",
    detail:
      "Name, DOB, address, and TIN collected and verified. CIP file lives in the core system — not on-chain.",
  },
  {
    id: "ofac",
    label: "OFAC / sanctions screening cleared",
    detail: "Screened at membership and again for this funding event.",
  },
  {
    id: "disclosures",
    label: "Truth in Savings disclosures delivered",
    detail: "APY, term, and early-withdrawal penalty match the product terms that will appear in the token datum.",
  },
  {
    id: "credential",
    label: "AccountHolderCredential ready",
    detail:
      "NCUA → InsuredInstitutionCredential → credit union → AccountHolderCredential → member DID. Oracle will verify this chain before attesting.",
  },
];

const TOKENIZE_DISCLOSURES: TokenizePrepDto["disclosures"] = [
  {
    id: "deposit_insured",
    text: "The share certificate (deposit) is held at the credit union and is federally insured by the NCUA up to applicable limits. The CDT token is a record of that certificate — the token itself is not insured.",
  },
  {
    id: "funds_stay",
    text: "Member dollars never leave the credit union. Minting a CDT does not move money on-chain; the vault in this demo is pre-funded settlement liquidity, not the member's insured balance leaving the core.",
  },
  {
    id: "non_transfer",
    text: "CDT units are freely transferable native assets. Payment terminals should optionally call the payment-oracle verification contract (challenge → verify → check signature) before accepting a CDT as consideration; that check does not freeze or lock the token.",
  },
  {
    id: "core_authoritative",
    text: "The core banking ledger remains the system of record for the insured claim. If a token is lost, the credit union can re-verify the member and reissue after invalidating the stranded token.",
  },
];

export interface AppOptions {
  pool: pg.Pool;
  /** Clock override for tests (epoch ms). */
  now?: () => number;
  chainProvider?: string | undefined;
  koiosBaseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Optional shared presentment store (tests inject a fresh one). */
  presentmentStore?: PresentmentStore;
  /** Optional payment oracle (tests inject for stable keys / isolation). */
  paymentOracle?: PaymentOracle;
  /**
   * API key for protected routes. Pass explicit string for tests.
   * Pass `null` with allowOpenApi for open lab mode.
   */
  apiKey?: string | null;
  /** When true and apiKey is null/empty, skip auth (lab/tests only). */
  allowOpenApi?: boolean;
  /** Burn validation mode for accept-burn. */
  burnValidateMode?: "off" | "soft" | "strict";
  /** Optional CDT mint policy id (hex) for burn matching. */
  cdtPolicyId?: string;
  /** Optional settlement payment rail. */
  settlementRail?: import("./settlement-rail.js").SettlementRail;
  /** Issuer institutional key (SettlementAuth / accept / pay). */
  issuerApiKey?: string;
  /** Correspondent institutional key (presentment / burn-evidence). */
  correspondentApiKey?: string;
  /** HS256 secret for institutional JWTs. */
  jwtSecret?: string;
  /** Optional deposit registry (tests inject). */
  depositRegistry?: DepositRegistry;
  /** Optional sign-request store (tests inject). */
  signRequestStore?: SignRequestStore;
  /** Optional CIP/IDV provider (tests inject). */
  identityProvider?: IdentityProvider;
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
  const depositRegistry = options.depositRegistry ?? new DepositRegistry(pool);
  void depositRegistry.init();
  const presentments =
    options.presentmentStore ??
    new PresentmentStore({
      pool,
      burnValidation: {
        mode: options.burnValidateMode ?? "off",
        provider: options.chainProvider,
        koiosBaseUrl,
        policyId: options.cdtPolicyId,
        fetchImpl: options.fetchImpl,
      },
      settlementRail: options.settlementRail,
      depositRegistry,
    });
  void presentments.init();
  const paymentOracle = options.paymentOracle ?? new PaymentOracle();
  const signRequests = options.signRequestStore ?? new SignRequestStore();
  const identityProvider =
    options.identityProvider ??
    (() => {
      try {
        return identityProviderFromEnv();
      } catch {
        return identityProviderFromEnv({ CDT_IDV_MODE: "mock" });
      }
    })();
  const allowOpenApi = options.allowOpenApi === true;
  const apiKey =
    options.apiKey === null
      ? undefined
      : options.apiKey === undefined
        ? undefined
        : options.apiKey;

  const app = new Hono();
  app.use("*", securityHeaders());
  app.use(
    "/api/*",
    rateLimit({ windowMs: 60_000, max: 300 }),
  );
  const roleKeys: RoleKeys = {
    ...(apiKey ? { apiKey } : {}),
    ...(options.issuerApiKey ? { issuerKey: options.issuerApiKey } : {}),
    ...(options.correspondentApiKey
      ? { correspondentKey: options.correspondentApiKey }
      : {}),
    ...(options.jwtSecret ? { jwtSecret: options.jwtSecret } : {}),
  };
  app.use("/api/*", async (c, next) => {
    if (
      allowOpenApi &&
      !apiKey &&
      !options.issuerApiKey &&
      !options.correspondentApiKey &&
      !options.jwtSecret
    ) {
      return next();
    }
    if (isPublicPath(c.req.path)) {
      return next();
    }
    if (options.issuerApiKey || options.correspondentApiKey || options.jwtSecret) {
      return publicOrRoleAuthed(roleKeys, c, next, settlementRoleForPath);
    }
    return publicOrAuthed(apiKey, c, next);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  /** Create a mobile wallet sign request (QR claim URL). */
  app.post("/api/sign-requests", async (c) => {
    let body: {
      purpose?: string;
      cborHex?: string;
      depositId?: string;
      presentmentId?: number;
      description?: string;
      publicBaseUrl?: string;
      deepLinkTemplate?: string;
      ttlMs?: number;
      requiredSignerHint?: string;
      walletBrand?: string;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "Request body must be JSON." }, 400);
    }
    if (!body.cborHex || typeof body.cborHex !== "string") {
      return c.json({ error: "cborHex is required (unsigned tx CBOR hex)." }, 400);
    }
    const purpose = (body.purpose || "generic") as
      | "redeem"
      | "early_withdraw"
      | "burn"
      | "generic";
    if (!["redeem", "early_withdraw", "burn", "generic"].includes(purpose)) {
      return c.json({ error: "Invalid purpose." }, 400);
    }
    const publicBaseUrl =
      body.publicBaseUrl?.trim() ||
      `${c.req.header("x-forwarded-proto") ?? "http"}://${c.req.header("host") ?? "localhost"}/#`;
    try {
      const dto = await signRequests.create({
        purpose,
        cborHex: body.cborHex,
        depositId: body.depositId,
        presentmentId: body.presentmentId,
        description: body.description,
        publicBaseUrl,
        deepLinkTemplate: body.deepLinkTemplate,
        ttlMs: body.ttlMs,
        requiredSignerHint: body.requiredSignerHint,
        walletBrand: body.walletBrand as import("./wallet-deeplinks.js").WalletBrand | undefined,
      });
      return c.json(dto, 201);
    } catch (err) {
      return c.json({ error: String(err) }, 400);
    }
  });

  app.get("/api/sign-requests/:id", (c) => {
    const id = c.req.param("id");
    const result = signRequests.publicView(id, now());
    if ("error" in result) {
      return c.json({ error: result.error }, result.status as 404);
    }
    return c.json(result);
  });

  app.post("/api/sign-requests/:id/complete", async (c) => {
    const id = c.req.param("id");
    let body: { signedCborHex?: string; witnessCborHex?: string };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "Request body must be JSON." }, 400);
    }
    const result = signRequests.complete(id, body, now());
    if ("error" in result) {
      return c.json({ error: result.error }, result.status as 400 | 404 | 410 | 422);
    }
    return c.json(result);
  });

  /**
   * Mint a short-lived institutional JWT.
   * Requires a static master/api key (not JWT-for-JWT) + CDT_JWT_SECRET.
   */
  app.post("/api/auth/token", async (c) => {
    if (!options.jwtSecret) {
      return c.json({ error: "CDT_JWT_SECRET not configured." }, 503);
    }
    const presented =
      c.req.header("x-api-key") ??
      c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    // Only static keys can mint JWTs (not an existing JWT).
    const mintKeys: RoleKeys = {
      ...(apiKey ? { apiKey } : {}),
      ...(options.issuerApiKey ? { issuerKey: options.issuerApiKey } : {}),
      ...(options.correspondentApiKey
        ? { correspondentKey: options.correspondentApiKey }
        : {}),
    };
    if (!mintKeys.apiKey && !mintKeys.issuerKey && !mintKeys.correspondentKey) {
      return c.json(
        { error: "Static API key required to mint JWTs (set CDT_API_KEY or dual keys)." },
        503,
      );
    }
    // Caller must present a valid static key for the requested role (or legacy any).
    let body: { role?: string; sub?: string; ttlSec?: number };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "Request body must be JSON." }, 400);
    }
    if (body.role !== "issuer" && body.role !== "correspondent") {
      return c.json({ error: "role must be 'issuer' or 'correspondent'." }, 400);
    }
    if (typeof body.sub !== "string" || !body.sub.trim()) {
      return c.json({ error: "sub (institution/operator id) is required." }, 400);
    }
    const grant = credentialGrantsRole(
      mintKeys,
      presented,
      body.role === "issuer" ? "issuer" : "correspondent",
    );
    // Allow minting with matching dual key OR shared api key
    if (!grant.ok) {
      // Legacy: shared apiKey can mint either role
      const legacy = credentialGrantsRole(mintKeys, presented, "any");
      if (!legacy.ok) {
        return c.json({ error: grant.error }, grant.status);
      }
    }
    const { signJwt } = await import("./jwt.js");
    try {
      const token = signJwt(
        {
          role: body.role,
          sub: body.sub.trim(),
          ttlSec:
            typeof body.ttlSec === "number" && body.ttlSec > 0 && body.ttlSec <= 86_400
              ? body.ttlSec
              : 3600,
        },
        options.jwtSecret,
      );
      return c.json({
        token,
        token_type: "Bearer",
        expires_in:
          typeof body.ttlSec === "number" && body.ttlSec > 0 && body.ttlSec <= 86_400
            ? body.ttlSec
            : 3600,
        role: body.role,
        sub: body.sub.trim(),
      });
    } catch (err) {
      return c.json({ error: String(err) }, 400);
    }
  });

  app.get("/api/openapi.json", async (c) => {
    try {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      // Prefer monorepo docs path when running from webapp/
      const candidates = [
        join(process.cwd(), "docs/openapi/settlement-v1.yaml"),
        join(process.cwd(), "../docs/openapi/settlement-v1.yaml"),
      ];
      const { existsSync } = await import("node:fs");
      const path = candidates.find((p) => existsSync(p));
      if (!path) {
        return c.json(
          {
            openapi: "3.1.0",
            info: {
              title: "CDT Settlement Network API",
              version: "0.2.0",
              description: "See docs/openapi/settlement-v1.yaml in the repository.",
            },
          },
          200,
        );
      }
      // Serve YAML as text; clients can convert. Also expose path.
      const yaml = await readFile(path, "utf8");
      return c.text(yaml, 200, {
        "content-type": "application/yaml; charset=utf-8",
        "x-openapi-source": path,
      });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // --- Attestation proof (verifiable link deposit ↔ account) ---------------
  app.get("/api/attestations/:depositId", async (c) => {
    const depositId = c.req.param("depositId");
    const { rows } = await pool.query(
      `SELECT a.transaction_id, a.deposit_id, a.account_id, a.attestation_hash,
              a.payload, a.signed_at,
              t.amount_cents, t.attested,
              acc.member_name, acc.wallet_address, acc.did
         FROM attestations a
         JOIN transactions t ON t.id = a.transaction_id
         JOIN accounts acc ON acc.id = t.account_id
        WHERE a.deposit_id = $1 OR a.transaction_id::text = $1
        LIMIT 1`,
      [depositId],
    );
    const row = rows[0];
    if (!row) return c.json({ error: "Attestation not found." }, 404);
    const payload = row.payload;
    return c.json({
      depositId: row.deposit_id,
      accountId: row.account_id,
      attestationHash: row.attestation_hash,
      transactionId: row.transaction_id,
      signedAt: row.signed_at,
      attested: row.attested,
      // Linkage fields (no full member dossier)
      ownerWallet: row.wallet_address,
      ownerDid: row.did,
      signedAttestation: payload,
      verification: {
        schema: "cdt.attestation.v2",
        instructions:
          "Verify Ed25519 signature over canonicalize(payload) with the pinned mint-oracle public key; recompute SHA-256(canonicalize(payload)) and match attestationHash and vault datum.attestation_hash; require payload.account_id and deposit_id match the bank claim.",
      },
    });
  });

  // --- CD product catalog ---------------------------------------------------
  app.get("/api/products", async (c) => {
    const { rows } = await pool.query(
      `SELECT id AS product_id, name, term_months, rate_bps, penalty_bps, min_deposit_cents
         FROM cd_products ORDER BY term_months, id`,
    );
    const products: ProductDto[] = rows.map(productDtoFromRow);
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

    // The payout curve is only needed by the certificate detail view.
    const includeCurve = c.req.query("curve") === "1";
    const { rows } = await pool.query(CDS_SQL, [member.walletAddress, member.did]);
    return c.json(rows.map((row) => toCdDto(row as CdRow, now(), includeCurve)));
  });

  // --- Bank desk: tokenization prep (CIP checklist + accounts) ----------------
  app.get("/api/members/:id/tokenize-prep", async (c) => {
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
    const funding = accounts.find((a) => a.kind === "cd_funding") ?? null;
    const prep: TokenizePrepDto = {
      member: {
        id,
        memberName: member.memberName,
        walletAddress: member.walletAddress,
        did: member.did,
      },
      accounts,
      hasCdFunding: funding !== null,
      cdFundingAccountId: funding?.id ?? null,
      insuranceLimitCents: INSURANCE_LIMIT_CENTS,
      checks: TOKENIZE_CHECKS,
      disclosures: TOKENIZE_DISCLOSURES,
      amountPresetsCents: [500_00, 1_000_00, 10_000_00, 100_000_00, 250_000_00],
    };
    return c.json(prep);
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
    if (amountCents > MAX_DEPOSIT_CENTS) {
      return c.json({ error: "Deposit amount is too large to tokenize." }, 422);
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

  // --- Correspondent presentment (foreign CDT cash-out desk) -----------------
  app.get("/api/correspondent/meta", (c) =>
    c.json({
      presentingCuName: defaultPresentingCu,
      issuerName: defaultIssuerName,
      role: "correspondent_presenting_cu",
      description:
        "Desk for a non-issuing credit union that verifies a foreign CDT and may advance cash against settlement from the issuer.",
      settlementNetwork: {
        messages: [
          "ClaimLookup",
          "PresentmentRequest",
          "SettlementAuth",
          "BurnEvidence",
          "BurnAccepted",
          "SettlementPayment",
        ],
        holdUntilBurn: true,
      },
    }),
  );

  app.get("/api/settlement/pubkey", (c) =>
    c.json({
      algorithm: "Ed25519",
      publicKeySpkiBase64: presentments.getSigner().publicKeySpkiBase64,
      purpose: "cdt.settlement_auth.v1",
      issuerInstitutionId: presentments.getSigner().issuerInstitutionId,
    }),
  );

  app.get("/api/claims/:ref", async (c) => {
    const raw = c.req.param("ref");
    if (!raw || !raw.trim()) return c.json({ error: "Claim reference is required." }, 400);
    const claim = await lookupClaim(pool, raw, now());
    if (!claim) return c.json({ error: "No certificate found for that deposit / transaction id." }, 404);
    return c.json(claim satisfies ClaimLookupDto);
  });

  app.get("/api/presentments", async (c) => c.json(await presentments.list()));

  app.get("/api/presentments/:id", async (c) => {
    const id = parseIdParam(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid presentment id." }, 400);
    const row = await presentments.get(id);
    if (!row) return c.json({ error: "Presentment not found." }, 404);
    return c.json(row);
  });

  app.get("/api/presentments/:id/events", async (c) => {
    const id = parseIdParam(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid presentment id." }, 400);
    const row = await presentments.get(id);
    if (!row) return c.json({ error: "Presentment not found." }, 404);
    return c.json(await presentments.listEvents(id));
  });

  app.post("/api/presentments", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be JSON." }, 400);
    }
    const req = (body ?? {}) as PresentmentRequest & {
      requireIdv?: boolean;
      cipComplete?: boolean;
      ofacCleared?: boolean;
      ownershipVerified?: boolean;
    };
    if (typeof req.claimRef !== "string" || !req.claimRef.trim()) {
      return c.json({ error: "claimRef is required." }, 400);
    }
    const claim = await lookupClaim(pool, req.claimRef, now());
    if (!claim) return c.json({ error: "No certificate found for that claim reference." }, 404);

    // Optional server-side CIP/OFAC/ownership gate (CDT_IDV_MODE).
    if (req.requireIdv === true || process.env.CDT_IDV_REQUIRE === "1") {
      const idv = await identityProvider.check(
        {
          kind: "composite",
          subjectName: req.walkInName ?? claim.holderName,
          holderDid: claim.holderDid,
          walletAddress: claim.holderWallet,
          cipComplete: req.cipComplete === true || req.checks?.cip === true,
          ofacCleared: req.ofacCleared === true || req.checks?.ofac === true,
          ownershipVerified:
            req.ownershipVerified === true || req.checks?.ownershipProof === true,
          correlationId: req.claimRef,
        },
        now(),
      );
      if (!idv.ok) {
        return c.json(
          {
            error: "Identity verification failed.",
            idv,
          },
          422,
        );
      }
    }

    const result = await presentments.create({ claim, body: req, nowMs: now() });
    if ("error" in result) {
      return c.json({ error: result.error }, result.status as 400 | 409 | 422);
    }
    return c.json(result satisfies PresentmentDto, 201);
  });

  /** Run CIP/IDV/OFAC check without creating a presentment. */
  app.post("/api/idv/check", async (c) => {
    let body: IdvCheckRequest;
    try {
      body = (await c.req.json()) as IdvCheckRequest;
    } catch {
      return c.json({ error: "Request body must be JSON." }, 400);
    }
    if (!body.subjectName?.trim()) {
      return c.json({ error: "subjectName is required." }, 400);
    }
    const kind = body.kind || "composite";
    const result = await identityProvider.check({ ...body, kind }, now());
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/idv/provider", (c) =>
    c.json({
      name: identityProvider.name,
      modes: ["mock", "http", "disabled"],
      env: "CDT_IDV_MODE / CDT_IDV_URL / CDT_IDV_TOKEN / CDT_IDV_REQUIRE",
    }),
  );

  app.get("/api/wallets/brands", (c) => c.json({ brands: listWalletBrands() }));

  /** Issue SettlementAuth (signed, burn_required, TTL). */
  app.post("/api/presentments/:id/authorize", async (c) => {
    const id = parseIdParam(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid presentment id." }, 400);
    const result = await presentments.authorize(id, now());
    if ("error" in result) {
      return c.json({ error: result.error }, result.status as 404 | 422);
    }
    return c.json(result);
  });

  /** Submit BurnEvidence (Cardano burn tx hash). */
  app.post("/api/presentments/:id/burn-evidence", async (c) => {
    const id = parseIdParam(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid presentment id." }, 400);
    let body: { txHash?: string; mode?: string };
    try {
      body = (await c.req.json()) as { txHash?: string; mode?: string };
    } catch {
      return c.json({ error: "Request body must be JSON." }, 400);
    }
    if (typeof body.txHash !== "string") {
      return c.json({ error: "txHash is required." }, 400);
    }
    const result = await presentments.submitBurnEvidence(id, {
      txHash: body.txHash,
      mode: body.mode,
    }, now());
    if ("error" in result) {
      return c.json({ error: result.error }, result.status as 400 | 404 | 409 | 422);
    }
    return c.json(result);
  });

  /** Issuer accepts burn (BurnAccepted) after validation. */
  app.post("/api/presentments/:id/accept-burn", async (c) => {
    const id = parseIdParam(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid presentment id." }, 400);
    const result = await presentments.acceptBurn(id, now());
    if ("error" in result) {
      return c.json(
        { error: result.error, reasonCode: "reasonCode" in result ? result.reasonCode : undefined },
        result.status as 404 | 422,
      );
    }
    return c.json(result);
  });

  /** Record SettlementPayment after core close. */
  app.post("/api/presentments/:id/settlement-payment", async (c) => {
    const id = parseIdParam(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid presentment id." }, 400);
    let body: { amountCents?: number; rail?: string; traceId?: string; paidAt?: string };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "Request body must be JSON." }, 400);
    }
    if (typeof body.amountCents !== "number") {
      return c.json({ error: "amountCents is required (rail/traceId optional — mock ACH fills them)." }, 400);
    }
    const idempotencyKey =
      c.req.header("idempotency-key") ?? c.req.header("x-idempotency-key") ?? undefined;
    const result = await presentments.recordSettlementPayment(
      id,
      {
        amountCents: body.amountCents,
        rail: body.rail,
        traceId: body.traceId,
        paidAt: body.paidAt,
        idempotencyKey,
      },
      now(),
    );
    if ("error" in result) {
      return c.json({ error: result.error }, result.status as 404 | 409 | 422);
    }
    return c.json(result);
  });

  app.get("/api/deposit-registry/:depositId", async (c) => {
    const depositId = c.req.param("depositId")?.trim();
    if (!depositId) return c.json({ error: "depositId required." }, 400);
    const row = await depositRegistry.get(depositId);
    if (!row) return c.json({ error: "Not in registry." }, 404);
    return c.json(row);
  });

  // --- Payment terminal: opt-in oracle attestation check (free-spend CDT) ----
  app.get("/api/payment/oracle-pubkey", (c) => c.json(paymentOracle.pubkey()));

  app.get("/api/payment/contract", (c) =>
    c.json({
      name: "cdt.payment_check.v1",
      paradigm: "freely_spendable",
      description:
        "Payment terminals optionally verify issuer deposit attestation via an oracle before accepting a CDT. Transfers remain unconstrained on-chain.",
      flow: [
        "GET /api/payment/oracle-pubkey — pin the oracle key",
        "POST /api/payment/challenge — one-time nonce",
        "POST /api/payment/verify — { claimRef, merchantId, challenge, amountCents?, payerWallet }",
        "Locally verify Ed25519 signature over canonical JSON of signedCheck.payload",
        "Accept payment only if ok and signature valid and not expired",
      ],
      nonGoals: [
        "Does not lock, freeze, or allowlist CDT transfers",
        "Does not replace core-banking redemption",
        "Does not move insured deposit funds",
      ],
    }),
  );

  app.post("/api/payment/challenge", (c) => c.json(paymentOracle.issueChallenge(now())));

  app.post("/api/payment/verify", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be JSON." }, 400);
    }
    try {
      const result = await paymentOracle.verify(pool, body as PaymentVerifyRequest, now());
      return c.json(result);
    } catch (err) {
      console.error("payment verify failed:", err);
      return c.json(
        {
          ok: false,
          reason: `Oracle could not reach the issuer core ledger: ${String(err)}`,
        },
        503,
      );
    }
  });

  app.post("/api/payment/verify-signature", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be JSON." }, 400);
    }
    const signed = body as SignedPaymentCheck;
    if (!signed || typeof signed !== "object" || !signed.payload || !signed.signature) {
      return c.json({ error: "Body must be a SignedPaymentCheck." }, 400);
    }
    return c.json(paymentOracle.verifySignedCheck(signed, now()));
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
