/**
 * Payment terminal: opt-in oracle attestation check for freely spendable CDT.
 */
import { useEffect, useState, type FormEvent } from "react";
import type {
  PaymentChallengeDto,
  PaymentOraclePubKeyDto,
  PaymentVerifyResponse,
  SignedPaymentCheck,
} from "../../shared/types.js";
import { ApiRequestError, api } from "../api.js";
import { ErrorNote, Spinner } from "../components.js";
import { money, percentFromBps, shortHash } from "../format.js";

export function PaymentTerminal() {
  const [contract, setContract] = useState<{
    name: string;
    paradigm: string;
    description: string;
    flow: string[];
    nonGoals: string[];
  } | null>(null);
  const [pubkey, setPubkey] = useState<PaymentOraclePubKeyDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [merchantId, setMerchantId] = useState("merchant-demo-001");
  const [claimRef, setClaimRef] = useState("");
  const [amountText, setAmountText] = useState("");
  const [payerWallet, setPayerWallet] = useState("");
  const [challenge, setChallenge] = useState<PaymentChallengeDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PaymentVerifyResponse | null>(null);
  const [sigCheck, setSigCheck] = useState<{ valid: boolean; reason?: string } | null>(null);

  useEffect(() => {
    Promise.all([api.paymentContract(), api.paymentOraclePubkey()])
      .then(([c, k]) => {
        setContract(c);
        setPubkey(k);
      })
      .catch((err) => setLoadError(String(err)));
  }, []);

  const amountCents = (() => {
    const t = amountText.replace(/[$,\s]/g, "");
    if (!t) return undefined;
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    return Math.round(Number(t) * 100);
  })();

  const runCheck = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    setSigCheck(null);
    try {
      if (amountCents === null) {
        throw new Error("Invoice amount must look like 12.50");
      }
      const ch = await api.paymentChallenge();
      setChallenge(ch);
      const verified = await api.paymentVerify({
        claimRef: claimRef.trim(),
        merchantId: merchantId.trim(),
        challenge: ch.challenge,
        ...(amountCents !== undefined ? { amountCents } : {}),
        ...(payerWallet.trim() ? { payerWallet: payerWallet.trim() } : {}),
      });
      setResult(verified);
      if (verified.ok) {
        const local = await api.paymentVerifySignature(verified.signedCheck);
        setSigCheck(local);
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loadError) return <ErrorNote message={loadError} />;
  if (!contract || !pubkey) return <Spinner label="Loading payment-check contract…" />;

  return (
    <section className="openflow openflow--desk present">
      <div className="desk-banner">
        <span className="desk-banner__role">Payment terminal</span>
        <strong>cdt.payment_check.v1</strong>
        <span className="muted">
          Paradigm: <em>freely spendable</em> — oracle check is optional extra security
        </span>
      </div>

      <h1 className="display">Accept CDT with oracle check</h1>
      <p className="lede">
        {contract.description} This does not freeze or allowlist transfers; wallets can still
        send CDT freely. Terminals that want assurance call the oracle first.
      </p>

      <div className="wizpanel" style={{ marginBottom: "1rem" }}>
        <h2 className="step">Contract</h2>
        <ol className="disclosures" style={{ listStyle: "decimal" }}>
          {contract.flow.map((line) => (
            <li key={line}>
              <code className="mono">{line}</code>
            </li>
          ))}
        </ol>
        <p className="muted small">
          Non-goals: {contract.nonGoals.join(" · ")}
        </p>
        <p className="mono small muted">
          Oracle SPKI (pin this): {pubkey.publicKeySpkiBase64.slice(0, 40)}…
        </p>
      </div>

      <form className="wizpanel" onSubmit={runCheck}>
        <h2 className="step">Terminal inputs</h2>
        <label className="field">
          <span>Merchant id</span>
          <input value={merchantId} onChange={(e) => setMerchantId(e.currentTarget.value)} required />
        </label>
        <label className="field">
          <span>CDT claim ref (deposit id / tx id)</span>
          <input
            value={claimRef}
            onChange={(e) => setClaimRef(e.currentTarget.value)}
            placeholder="e.g. 4"
            required
          />
        </label>
        <label className="field">
          <span>Invoice amount (optional, USD)</span>
          <input
            value={amountText}
            onChange={(e) => setAmountText(e.currentTarget.value)}
            placeholder="250.00"
            inputMode="decimal"
          />
        </label>
        <label className="field">
          <span>Payer wallet (optional match to attested owner)</span>
          <input
            value={payerWallet}
            onChange={(e) => setPayerWallet(e.currentTarget.value)}
            placeholder="addr1…"
            className="mono"
          />
        </label>
        {error && <ErrorNote message={error} />}
        <div className="wizactions">
          <button className="button" type="submit" disabled={busy || !claimRef.trim()}>
            {busy ? "Checking oracle…" : "Request challenge & verify attestation"}
          </button>
        </div>
        {challenge && (
          <p className="muted small mono">
            Last challenge: {challenge.challenge.slice(0, 16)}… (one-time, consumed on verify)
          </p>
        )}
      </form>

      {result && !result.ok && (
        <div className="wizpanel" style={{ marginTop: "1rem" }}>
          <div className="note note--error" role="alert">
            <strong>Refuse / hold:</strong> {result.reason}
          </div>
          {result.claimSummary && (
            <p className="muted small">
              Claim #{result.claimSummary.transactionId} · {result.claimSummary.holderName} ·{" "}
              {result.claimSummary.status}
            </p>
          )}
        </div>
      )}

      {result && result.ok && (
        <div className="wizpanel" style={{ marginTop: "1rem" }}>
          <div className="note note--ok">
            <p>
              <strong>Oracle attestation check passed.</strong> Signature re-check:{" "}
              {sigCheck?.valid ? "valid ✓" : `invalid (${sigCheck?.reason ?? "—"})`}
            </p>
          </div>
          <PaymentCheckView check={result.signedCheck} advice={result.advice} />
        </div>
      )}
    </section>
  );
}

function PaymentCheckView({
  check,
  advice,
}: {
  check: SignedPaymentCheck;
  advice: string[];
}) {
  const p = check.payload;
  return (
    <>
      <table className="terms">
        <tbody>
          <tr>
            <th>Schema</th>
            <td className="mono">{p.schema}</td>
          </tr>
          <tr>
            <th>Freely spendable</th>
            <td>{p.freelySpendable ? "yes (not locked by this check)" : "no"}</td>
          </tr>
          <tr>
            <th>Deposit / status</th>
            <td>
              {p.depositId} · {p.status}
            </td>
          </tr>
          <tr>
            <th>Holder</th>
            <td>
              {p.holderName} · {percentFromBps(p.rateBps)} · principal {money(p.principalCents)}
            </td>
          </tr>
          <tr>
            <th>Owner wallet</th>
            <td className="mono">{p.ownerWallet}</td>
          </tr>
          <tr>
            <th>Merchant / invoice</th>
            <td>
              {p.merchantId}
              {p.amountCents != null ? ` · ${money(p.amountCents)}` : " · no invoice amount"}
            </td>
          </tr>
          <tr>
            <th>Mint tx</th>
            <td className="mono">{p.mintTxHash ? shortHash(p.mintTxHash) : "—"}</td>
          </tr>
          <tr>
            <th>Valid until</th>
            <td>{new Date(p.expiresAtMs).toLocaleString()}</td>
          </tr>
          <tr>
            <th>Signature</th>
            <td className="mono">{check.signature.slice(0, 32)}…</td>
          </tr>
        </tbody>
      </table>
      <ul className="disclosures">
        {advice.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </>
  );
}
