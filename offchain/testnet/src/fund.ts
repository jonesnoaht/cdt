/**
 * `npm run fund` — get tADA onto the issuer wallet, then distribute working
 * balances to the member and oracle wallets.
 *
 * Funding path:
 *  1. If the issuer already holds enough, skip straight to distribution.
 *  2. Try the official preview faucet API programmatically
 *     (https://faucet.preview.world.dev.cardano.org/send-money/<address>,
 *     optional `api_key` query param via the FAUCET_API_KEY env var).
 *  3. Whether or not the API call succeeds (it may be captcha-gated), print
 *     manual faucet instructions and poll the issuer balance until funded or
 *     FUND_TIMEOUT_MS (default 10 minutes) elapses.
 */

import {
  awaitOutputAt,
  fmtAda,
  loadWallets,
  lovelaceAt,
  makeLucid,
  sleep,
  submitAndConfirm,
  withRetry,
} from "./common.js";

/**
 * Issuer needs to bankroll two CDs (principal + full interest, ~105 tADA
 * each), fees, AND still exceed lifecycle.ts's 250 tADA preflight AFTER
 * distributing MEMBER_GRANT + ORACLE_GRANT (210 tADA) below.
 */
const ISSUER_TARGET = 700_000_000n; // 700 tADA
const MEMBER_TARGET = 50_000_000n; // member pays redeem fees + holds min-ADA UTxOs
const MEMBER_GRANT = 200_000_000n;
const ORACLE_TARGET = 2_000_000n; // oracle only co-signs; a token balance for completeness
const ORACLE_GRANT = 10_000_000n;

const FAUCET_BASE =
  process.env["FAUCET_URL"] ??
  "https://faucet.preview.world.dev.cardano.org/send-money";
/**
 * The preview faucet rejects keyless API calls (FaucetWebErrorInvalidApiKey);
 * the web form instead sends a reCAPTCHA token. This default is the
 * community-shared preview API key that has been committed to multiple public
 * repositories for years (e.g. adacapital/spot) — it is not a secret and only
 * dispenses valueless preview tADA. Override with FAUCET_API_KEY if needed.
 */
const FAUCET_API_KEY =
  process.env["FAUCET_API_KEY"] ?? "nohnuXahthoghaeNoht9Aow3ze4quohc";
const envTimeout = Number(process.env["FUND_TIMEOUT_MS"]);
const FUND_TIMEOUT_MS =
  Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 600_000;
const POLL_INTERVAL_MS = 15_000;

async function tryFaucet(address: string): Promise<boolean> {
  const query = FAUCET_API_KEY
    ? `?api_key=${encodeURIComponent(FAUCET_API_KEY)}`
    : "";
  // Both historical shapes of the faucet API: path param and query param.
  const candidates = [
    { method: "POST", url: `${FAUCET_BASE}/${address}${query}` },
    {
      method: "POST",
      url: `${FAUCET_BASE}?address=${encodeURIComponent(address)}${query.replace("?", "&")}`,
    },
    { method: "GET", url: `${FAUCET_BASE}/${address}${query}` },
  ] as const;
  for (const { method, url } of candidates) {
    try {
      const response = await fetch(url, { method });
      const body = await response.text();
      console.log(`  faucet ${method} ${url}`);
      console.log(`    -> HTTP ${response.status}: ${body.slice(0, 300)}`);
      // A successful grant returns JSON like {"amount":{...},"txid":"..."};
      // failures return {"error":{"tag":"FaucetWebError..."}}.
      try {
        const parsed = JSON.parse(body) as { txid?: string; error?: unknown };
        if (response.ok && typeof parsed.txid === "string" && !parsed.error) {
          console.log(`  faucet grant tx: ${parsed.txid}`);
          return true;
        }
      } catch {
        // Non-JSON body: fall through to the next candidate.
      }
    } catch (error) {
      console.log(
        `  faucet ${method} request failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  return false;
}

async function main(): Promise<void> {
  const lucid = await makeLucid();
  const wallets = await loadWallets(lucid);
  const { issuer, member, oracle } = wallets;

  let issuerBalance = await lovelaceAt(lucid, issuer.address);
  console.log(`issuer  ${issuer.address}\n  balance: ${fmtAda(issuerBalance)}`);

  if (issuerBalance < ISSUER_TARGET) {
    console.log(`\nIssuer needs at least ${fmtAda(ISSUER_TARGET)}. Requesting from the preview faucet...`);
    const ok = await tryFaucet(issuer.address);
    if (!ok) {
      console.log("\nAutomatic faucet request did not obviously succeed.");
      console.log("Please fund the issuer address manually:");
      console.log(`  address: ${issuer.address}`);
      console.log("  faucet:  https://docs.cardano.org/cardano-testnets/tools/faucet");
      console.log("           (select the 'Preview Testnet' network)");
    }
    console.log(`\nPolling the issuer balance (timeout ${FUND_TIMEOUT_MS / 60_000} min)...`);
    const deadline = Date.now() + FUND_TIMEOUT_MS;
    while (issuerBalance < ISSUER_TARGET) {
      if (Date.now() > deadline) {
        console.error(
          `\nTimed out waiting for funds. Fund ${issuer.address} at https://docs.cardano.org/cardano-testnets/tools/faucet (Preview) and re-run 'npm run fund'.`,
        );
        process.exit(2);
      }
      await sleep(POLL_INTERVAL_MS);
      issuerBalance = await withRetry("poll issuer balance", () =>
        lovelaceAt(lucid, issuer.address),
      );
      console.log(`  issuer balance: ${fmtAda(issuerBalance)}`);
    }
  }
  console.log(`\nIssuer funded: ${fmtAda(issuerBalance)}`);

  // Distribute working balances to member + oracle from the issuer.
  const [memberBalance, oracleBalance] = await Promise.all([
    lovelaceAt(lucid, member.address),
    lovelaceAt(lucid, oracle.address),
  ]);
  console.log(`member  balance: ${fmtAda(memberBalance)}`);
  console.log(`oracle  balance: ${fmtAda(oracleBalance)}`);

  const payments: { address: string; lovelace: bigint; who: string }[] = [];
  if (memberBalance < MEMBER_TARGET) {
    payments.push({ address: member.address, lovelace: MEMBER_GRANT, who: "member" });
  }
  if (oracleBalance < ORACLE_TARGET) {
    payments.push({ address: oracle.address, lovelace: ORACLE_GRANT, who: "oracle" });
  }
  if (payments.length === 0) {
    console.log("\nMember and oracle already funded; nothing to distribute.");
    return;
  }

  console.log(
    `\nDistributing from issuer: ${payments.map((p) => `${p.who} ${fmtAda(p.lovelace)}`).join(", ")}`,
  );
  lucid.selectWallet.fromPrivateKey(issuer.privateKey);
  const signed = await withRetry("build split tx", async () => {
    let txb = lucid.newTx();
    for (const p of payments) {
      txb = txb.pay.ToAddress(p.address, { lovelace: p.lovelace });
    }
    const tx = await txb.complete();
    return tx.sign.withWallet().complete();
  });
  const distTxHash = await submitAndConfirm(lucid, signed, "distribution tx");
  // Wait for the outputs to be indexed so the balance prints are not stale.
  for (const p of payments) {
    await awaitOutputAt(lucid, p.address, distTxHash, `${p.who} grant`);
  }

  const [memberFinal, oracleFinal] = await Promise.all([
    lovelaceAt(lucid, member.address),
    lovelaceAt(lucid, oracle.address),
  ]);
  console.log(`\nmember balance: ${fmtAda(memberFinal)}`);
  console.log(`oracle balance: ${fmtAda(oracleFinal)}`);
  console.log("\nNext: npm run lifecycle");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
