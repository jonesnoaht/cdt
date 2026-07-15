/**
 * Mobile sign-request desk / phone page.
 *
 * Desk creates a request with unsigned CBOR; QR encodes the claim URL
 * (not the full CBOR). Phone or desktop opens the page and signs with
 * **Lace (CIP-30)** when available, or pastes witnesses (lab).
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { ErrorNote, Spinner } from "../components.js";
import {
  detectCip30Wallets,
  signTxWithCip30,
  type DetectedWallet,
} from "../cip30.js";

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
  const [wallets, setWallets] = useState<DetectedWallet[]>([]);
  const [walletId, setWalletId] = useState<string>("lace");
  const [laceNote, setLaceNote] = useState<string | null>(null);

  const refreshWallets = useCallback(() => {
    const list = detectCip30Wallets();
    setWallets(list);
    if (list.some((w) => w.id === "lace")) {
      setWalletId("lace");
      setLaceNote(null);
    } else if (list[0]) {
      setWalletId(list[0].id);
      setLaceNote(
        "Lace not detected. Install the Lace browser extension (or open this page where Lace injects CIP-30), or pick another wallet.",
      );
    } else {
      setLaceNote(
        "No CIP-30 wallet detected. Install Lace from lace.io, enable the extension for this site, then click Refresh wallets.",
      );
    }
  }, []);

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

  useEffect(() => {
    refreshWallets();
    // Re-scan when extensions inject late
    const t = window.setTimeout(refreshWallets, 800);
    return () => window.clearTimeout(t);
  }, [refreshWallets]);

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
        walletBrand: "lace",
      })) as SignDto;
      setCreated(row);
      window.location.hash = `#/sign/${row.id}`;
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const complete = async (payload?: { signedCborHex?: string; witnessCborHex?: string }) => {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      const row = (await api.completeSignRequest(view.id, {
        signedCborHex: payload?.signedCborHex || signedIn || undefined,
        witnessCborHex: payload?.witnessCborHex || witnessIn || undefined,
      })) as SignDto;
      setView(row);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const signWithLace = async () => {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      const result = await signTxWithCip30({
        cborHex: view.cborHex,
        walletId: walletId || "lace",
        partialSign: true,
      });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      setWitnessIn(result.witnessCborHex);
      setLaceNote(
        `Signed with ${result.walletId} (network ${result.networkId}). Submitting witness set…`,
      );
      await complete({ witnessCborHex: result.witnessCborHex });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  if (requestId && !view && busy) {
    return (
      <section className="panel">
        <Spinner /> Loading sign request…
      </section>
    );
  }

  if (view) {
    const row = view;
    return (
      <section className="panel">
        <h1>Sign transaction</h1>
        <p className="lede">{row.description}</p>
        {error && <ErrorNote message={error} />}
        {busy && <Spinner />}
        <dl className="kv">
          <dt>Id</dt>
          <dd className="mono">{row.id}</dd>
          <dt>Purpose</dt>
          <dd>{row.purpose}</dd>
          <dt>Status</dt>
          <dd>{row.status}</dd>
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
            </div>

            <h2>Sign with Lace (CIP-30)</h2>
            <p className="muted">
              Preferred path: connect{" "}
              <a href="https://www.lace.io/" target="_blank" rel="noreferrer">
                Lace
              </a>{" "}
              via the browser CIP-30 connector, review the burn/redeem transaction, and sign.
              Multi-sig / oracle co-sign uses <code>partialSign=true</code>.
            </p>
            {laceNote && <p className="muted">{laceNote}</p>}
            <div className="wallet-connect-row" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
              <label>
                Wallet
                <select value={walletId} onChange={(e) => setWalletId(e.target.value)}>
                  {wallets.length === 0 && <option value="lace">Lace (not detected)</option>}
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label}
                      {w.id === "lace" ? " ★" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="secondary" disabled={busy} onClick={() => refreshWallets()}>
                Refresh wallets
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || wallets.length === 0}
                onClick={() => void signWithLace()}
              >
                {wallets.some((w) => w.id === "lace")
                  ? "Connect Lace & sign"
                  : "Connect wallet & sign"}
              </button>
            </div>
            {wallets.length > 0 && (
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                Detected: {wallets.map((w) => w.label).join(", ")}
              </p>
            )}

            <details style={{ marginTop: "1.5rem" }}>
              <summary>Unsigned CBOR (hex)</summary>
              <textarea
                className="mono"
                readOnly
                rows={6}
                value={row.cborHex}
                style={{ width: "100%" }}
              />
            </details>

            <details style={{ marginTop: "1rem" }}>
              <summary>Lab paste-back (if CIP-30 unavailable)</summary>
              <p className="muted">
                Paste signed tx CBOR and/or witness set hex after signing offline.
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
            </details>
          </>
        )}

        {row.status === "completed" && (
          <div className="ok-note">
            <p>
              <strong>Signed.</strong> Completed at {row.completedAt}
            </p>
            {row.witnessCborHex && (
              <details>
                <summary>Witness CBOR (from Lace / wallet)</summary>
                <textarea
                  className="mono"
                  readOnly
                  rows={4}
                  value={row.witnessCborHex}
                  style={{ width: "100%" }}
                />
              </details>
            )}
            {row.signedCborHex && (
              <details>
                <summary>Signed CBOR</summary>
                <textarea
                  className="mono"
                  readOnly
                  rows={4}
                  value={row.signedCborHex}
                  style={{ width: "100%" }}
                />
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

  return (
    <section className="panel">
      <h1>Create mobile sign request</h1>
      <p className="lede">
        Build a QR that points the member&apos;s phone or browser at an unsigned Cardano
        transaction (redeem / early withdraw / burn). Sign with{" "}
        <strong>Lace via CIP-30</strong> on the claim page — Bluetooth is not required.
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
        Full CBOR is stored server-side; the QR only encodes a short claim URL. On the claim
        page, choose <strong>Connect Lace &amp; sign</strong> (CIP-30).
      </p>
    </section>
  );
}
