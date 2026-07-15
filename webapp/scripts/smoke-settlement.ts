/**
 * Settlement network smoke against a running API + seeded bank-sim.
 *
 * Prereq:
 *   bank-sim up + `npm run seed`
 *   webapp api on :8787 with CDT_ALLOW_OPEN_API=1 (lab) or keys
 *
 * Usage:
 *   cd webapp && npm run smoke:settlement
 *   CLAIM_REF=6 WALK_IN='Satoshi Tanaka' npm run smoke:settlement
 */
const BASE = process.env.API_BASE || "http://127.0.0.1:8787";
const CLAIM = process.env.CLAIM_REF || "6";
const WALK_IN = process.env.WALK_IN || "Satoshi Tanaka";
const API_KEY = process.env.CDT_API_KEY || process.env.CDT_CORRESPONDENT_API_KEY;

function headers(json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h["content-type"] = "application/json";
  if (API_KEY) h["x-api-key"] = API_KEY;
  return h;
}

async function req(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body: parsed };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
}

function pass(msg: string): void {
  console.log(`PASS  ${msg}`);
}

async function main(): Promise<void> {
  const health = await req("GET", "/api/health");
  assert(health.status === 200, `health ${health.status}`);
  pass("health");

  const claim = await req("GET", `/api/claims/${encodeURIComponent(CLAIM)}`);
  assert(claim.status === 200, `claim lookup ${claim.status} ${JSON.stringify(claim.body)}`);
  const claimBody = claim.body as {
    redeemable?: boolean;
    cashOutCents?: number;
    holderName?: string;
    claim?: { status?: string };
  };
  assert(claimBody.redeemable === true, `claim ${CLAIM} not redeemable`);
  pass(`claim ${CLAIM} status=${claimBody.claim?.status} cashOut=${claimBody.cashOutCents}`);

  const present = await req("POST", "/api/presentments", {
    claimRef: CLAIM,
    walkInName: WALK_IN,
    checks: { cip: true, ofac: true, ownershipProof: true },
  });
  // 409 if already open — reuse list
  let id: number;
  if (present.status === 409) {
    const list = await req("GET", "/api/presentments");
    assert(list.status === 200, "list presentments");
    const rows = list.body as Array<{ id: number; status: string; depositId: string | null }>;
    const open = rows.find(
      (r) =>
        (r.depositId === CLAIM || String(r.id)) &&
        r.status !== "settled" &&
        r.status !== "rejected",
    );
    assert(open, `no open presentment to reuse after 409: ${JSON.stringify(present.body)}`);
    id = open.id;
    pass(`reuse presentment #${id} (${open.status})`);
  } else {
    assert(
    present.status === 200 || present.status === 201,
    `presentment ${present.status} ${JSON.stringify(present.body)}`,
  );
    id = (present.body as { id: number }).id;
    pass(`filed presentment #${id}`);
  }

  const cur = await req("GET", `/api/presentments/${id}`);
  let status = (cur.body as { status: string }).status;

  if (status === "pending_burn") {
    const auth = await req("POST", `/api/presentments/${id}/authorize`, {});
    assert(auth.status === 200, `authorize ${auth.status} ${JSON.stringify(auth.body)}`);
    status = (auth.body as { status: string }).status;
    pass("SettlementAuth issued");
  }

  if (status === "authorized") {
    const burnHash = "b".repeat(64);
    const burn = await req("POST", `/api/presentments/${id}/burn-evidence`, {
      txHash: burnHash,
      mode: "redeem",
    });
    assert(burn.status === 200, `burn-evidence ${burn.status} ${JSON.stringify(burn.body)}`);
    status = (burn.body as { status: string }).status;
    pass(`BurnEvidence ${burnHash.slice(0, 8)}…`);
  }

  if (status === "burn_submitted") {
    const acc = await req("POST", `/api/presentments/${id}/accept-burn`, {});
    assert(acc.status === 200, `accept-burn ${acc.status} ${JSON.stringify(acc.body)}`);
    status = (acc.body as { status: string }).status;
    pass("BurnAccepted");
  }

  if (status === "burn_accepted") {
    const cashOut =
      (cur.body as { cashOutCents?: number }).cashOutCents ??
      claimBody.cashOutCents ??
      (await req("GET", `/api/presentments/${id}`)).body;
    const amount =
      typeof cashOut === "number"
        ? cashOut
        : ((cashOut as { cashOutCents: number }).cashOutCents as number);
    const pay = await req("POST", `/api/presentments/${id}/settlement-payment`, {
      amountCents: amount,
    });
    assert(pay.status === 200, `settlement-payment ${pay.status} ${JSON.stringify(pay.body)}`);
    status = (pay.body as { status: string }).status;
    const rail = (pay.body as { settlementPayment?: { rail: string; traceId: string } })
      .settlementPayment;
    pass(`SettlementPayment ${rail?.rail} ${rail?.traceId}`);
  }

  assert(status === "settled", `expected settled, got ${status}`);
  const events = await req("GET", `/api/presentments/${id}/events`);
  assert(events.status === 200, "events");
  const ev = events.body as Array<{ eventType: string }>;
  pass(`audit events: ${ev.map((e) => e.eventType).join(" → ")}`);
  console.log("\nSMOKE SETTLEMENT COMPLETE");
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
