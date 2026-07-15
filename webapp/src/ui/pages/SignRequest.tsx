/**
 * Mobile sign-request desk / phone page.
 *
 * Desk creates a request with unsigned CBOR; QR encodes the claim URL
 * (not the full CBOR). Phone opens the page, shows CBOR hash, pastes
 * signed result back (lab) or wallet deep-link.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { ErrorNote, Spinner } from "../components.js";

type SignDto = {
  id: string;
  purpose: string;
  status: string;
  depositId?: string;
  presentmentId?: number;
  description: string;
  cborHex: string;
  cborHashHex: string;
  claimUrl: string;
  deepLink?: string;
  walletLinks?: Array<{ brand: string; label: string; url: string | null; notes?: string }>;
  qrDataUrl: string;
  requiredSignerHint?: string;
  expiresAt: string;
  createdAt: string;
  completedAt?: string;
  signedCborHex?: string;
  witnessCborHex?: string;
};

export function SignRequestPage({ requestId }: { requestId?: string }) {
  const [purpose, setPurpose] = useState("redeem");
  const [cborHex, setCborHex] = useState("");
  const [depositId, setDepositId] = useState("");
  const [description, setDescription] = useState("");
  const [created, setCreated] = useState<SignDto | null>(null);
  const [view, setView] = useState<SignDto | null>(null);
  const [signedIn, setSignedIn] = useState("");
  const [witnessIn, setWitnessIn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const row = (await api.getSignRequest(id)) as SignDto;
      setView(row);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (requestId) void load(requestId);
  }, [requestId, load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const publicBaseUrl = `${window.location.origin}${window.location.pathname}#`;
      const row = (await api.createSignRequest({
        purpose,
        cborHex,
        depositId: depositId || undefined,
        description: description || undefined,
        publicBaseUrl,
      })) as SignDto;
      setCreated(row);
      window.location.hash = `#/sign/${row.id}`;
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      const row = (await api.completeSignRequest(view.id, {
        signedCborHex: signedIn || undefined,
        witnessCborHex: witnessIn || undefined,
      })) as SignDto;
      setView(row);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  // Phone / desk view of existing request
  if (requestId || view) {
    const row = view;
    if (busy && !row) return <Spinner label="Loading sign request…" />;
    if (!row) {
      return (
        <section className="panel">
          <h1>Sign request</h1>
          {error && <ErrorNote message={error} />}
          <p className="muted">Not found or still loading.</p>
        </section>
      );
    }
    return (
      <section className="panel">
        <h1>Wallet sign request</h1>
        <p className="lede">{row.description}</p>
        {error && <ErrorNote message={error} />}
        <dl className="kv">
          <dt>Status</dt>
          <dd>
            <strong>{row.status}</strong>
          </dd>
          <dt>Purpose</dt>
          <dd>{row.purpose}</dd>
          {row.depositId && (
            <>
              <dt>Deposit</dt>
              <dd className="mono">{row.depositId}</dd>
            </>
          )}
          <dt>CBOR hash</dt>
          <dd className="mono">{row.cborHashHex}</dd>
          <dt>Expires</dt>
          <dd>{row.expiresAt}</dd>
          {row.requiredSignerHint && (
            <>
              <dt>Signer</dt>
              <dd className="mono">{row.requiredSignerHint}</dd>
            </>
          )}
        </dl>

        {row.status === "pending" && (
          <>
            <div className="qr-block" style={{ textAlign: "center", margin: "1.5rem 0" }}>
              <img src={row.qrDataUrl} alt="QR code for sign request" width={280} height={280} />
              <p className="muted">
                Scan with phone (opens this page). The QR holds the{" "}
                <strong>claim URL</strong>, not the full transaction CBOR.
              </p>
              <p className="mono" style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>
                {row.claimUrl}
              </p>
              {row.deepLink && (
                <p>
                  <a href={row.deepLink}>Open wallet deep link</a>
                </p>
              )}
              {row.walletLinks && row.walletLinks.length > 0 && (
                <ul className="wallet-links">
                  {row.walletLinks
                    .filter((w) => w.url)
                    .map((w) => (
                      <li key={w.brand}>
                        <a href={w.url!}>{w.label}</a>
                        {w.notes ? <span className="muted"> — {w.notes}</span> : null}
                      </li>
                    ))}
                </ul>
              )}
            </div>
            <details>
              <summary>Unsigned CBOR (hex)</summary>
              <textarea
                className="mono"
                readOnly
                rows={6}
                value={row.cborHex}
                style={{ width: "100%" }}
              />
            </details>
            <h2>Complete (lab paste-back)</h2>
            <p className="muted">
              Production wallets return witnesses via connector/deep-link callback.
              Lab: paste signed tx CBOR and/or witness set hex after signing offline.
            </p>
            <label>
              Signed tx CBOR hex
              <textarea
                className="mono"
                rows={3}
                value={signedIn}
                onChange={(e) => setSignedIn(e.target.value)}
                style={{ width: "100%" }}
              />
            </label>
            <label>
              Witness CBOR hex (optional)
              <textarea
                className="mono"
                rows={2}
                value={witnessIn}
                onChange={(e) => setWitnessIn(e.target.value)}
                style={{ width: "100%" }}
              />
            </label>
            <button type="button" className="primary" disabled={busy} onClick={() => void complete()}>
              Submit signature
            </button>
          </>
        )}

        {row.status === "completed" && (
          <div className="ok-note">
            <p>
              <strong>Signed.</strong> Completed at {row.completedAt}
            </p>
            {row.signedCborHex && (
              <details>
                <summary>Signed CBOR</summary>
                <textarea className="mono" readOnly rows={4} value={row.signedCborHex} style={{ width: "100%" }} />
              </details>
            )}
          </div>
        )}

        {(row.status === "expired" || row.status === "cancelled") && (
          <ErrorNote
            message={`This request is ${row.status}. Create a new one from the desk.`}
          />
        )}

        <p style={{ marginTop: "1.5rem" }}>
          <a href="#/sign">Create another sign request</a>
          {" · "}
          <a href="#/present">Correspondent desk</a>
        </p>
      </section>
    );
  }

  // Create form
  return (
    <section className="panel">
      <h1>Create mobile sign request</h1>
      <p className="lede">
        Build a QR that points the member&apos;s phone at an unsigned Cardano transaction
        (redeem / early withdraw / burn). Bluetooth is not required — QR + HTTP is the path.
      </p>
      {error && <ErrorNote message={error} />}
      {created && (
        <p className="ok-note">
          Created <a href={`#/sign/${created.id}`}>{created.id}</a>
        </p>
      )}
      <label>
        Purpose
        <select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
          <option value="redeem">redeem (mature)</option>
          <option value="early_withdraw">early_withdraw</option>
          <option value="burn">burn (correspondent cash-out)</option>
          <option value="generic">generic</option>
        </select>
      </label>
      <label>
        Deposit id (optional)
        <input value={depositId} onChange={(e) => setDepositId(e.target.value)} className="mono" />
      </label>
      <label>
        Description (optional)
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label>
        Unsigned tx CBOR hex
        <textarea
          className="mono"
          rows={8}
          value={cborHex}
          onChange={(e) => setCborHex(e.target.value)}
          placeholder="Paste Lucid/build unsigned tx CBOR as hex…"
          style={{ width: "100%" }}
        />
      </label>
      <button
        type="button"
        className="primary"
        disabled={busy || cborHex.trim().length < 2}
        onClick={() => void create()}
      >
        Create QR sign request
      </button>
      <p className="muted" style={{ marginTop: "1rem" }}>
        Full CBOR is stored server-side; the QR only encodes a short claim URL so large vault
        txs still fit a single code.
      </p>
    </section>
  );
}
