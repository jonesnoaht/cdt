/**
 * Correspondent desk: a non-issuing credit union faces a walk-in customer
 * holding a CDT issued by another CU, and may advance cash against settlement.
 */
import { useEffect, useState, type FormEvent } from "react";
import type { ClaimLookupDto, PresentmentDto } from "../../shared/types.js";
import { ApiRequestError, api } from "../api.js";
import { ErrorNote, Spinner, StatusBadge } from "../components.js";
import { date, money, percentFromBps, shortHash } from "../format.js";

type Step = "lookup" | "review" | "checks" | "done";

export function PresentForeign() {
  const [meta, setMeta] = useState<{
    presentingCuName: string;
    issuerName: string;
  } | null>(null);
  const [step, setStep] = useState<Step>("lookup");
  const [claimRef, setClaimRef] = useState("");
  const [walkInName, setWalkInName] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [claim, setClaim] = useState<ClaimLookupDto | null>(null);
  const [looking, setLooking] = useState(false);

  const [cip, setCip] = useState(false);
  const [ofac, setOfac] = useState(false);
  const [ownershipProof, setOwnershipProof] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<PresentmentDto | null>(null);
  const [history, setHistory] = useState<PresentmentDto[]>([]);

  useEffect(() => {
    api
      .correspondentMeta()
      .then((m) =>
        setMeta({ presentingCuName: m.presentingCuName, issuerName: m.issuerName }),
      )
      .catch((err) => setLoadError(String(err)));
    api.presentments().then(setHistory).catch(() => {});
  }, []);

  const doLookup = async (e: FormEvent) => {
    e.preventDefault();
    setLooking(true);
    setLookupError(null);
    setClaim(null);
    try {
      const result = await api.lookupClaim(claimRef.trim());
      setClaim(result);
      setWalkInName(result.holderName);
      setStep("review");
    } catch (err) {
      setLookupError(err instanceof ApiRequestError ? err.message : String(err));
    } finally {
      setLooking(false);
    }
  };

  const filePresentment = async (e: FormEvent) => {
    e.preventDefault();
    if (!claim) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await api.createPresentment({
        claimRef: claim.claim.depositId ?? String(claim.claim.transactionId),
        walkInName,
        presentingCuName: meta?.presentingCuName,
        checks: { cip, ofac, ownershipProof },
      });
      setTicket(created);
      setStep("done");
      const list = await api.presentments();
      setHistory(list);
    } catch (err) {
      setSubmitError(err instanceof ApiRequestError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setStep("lookup");
    setClaim(null);
    setTicket(null);
    setClaimRef("");
    setWalkInName("");
    setCip(false);
    setOfac(false);
    setOwnershipProof(false);
    setLookupError(null);
    setSubmitError(null);
  };

  if (loadError) return <ErrorNote message={loadError} />;
  if (!meta) return <Spinner label="Loading correspondent desk…" />;

  return (
    <section className="openflow openflow--desk present">
      <div className="desk-banner">
        <span className="desk-banner__role">Correspondent desk</span>
        <strong>{meta.presentingCuName}</strong>
        <span className="muted">
          You are <em>not</em> the issuer. Issuer of foreign CDTs in this demo:{" "}
          <strong>{meta.issuerName}</strong>.
        </span>
      </div>

      <h1 className="display">Redeem a foreign CDT for cash</h1>
      <p className="lede">
        A walk-in presents a Certificate of Deposit Token issued by another credit
        union. Verify the claim against the issuer&apos;s attested record, run local
        CIP/OFAC, quote cash-out, advance cash, and file settlement with the issuer.
        You do not unlock their vault yourself.
      </p>

      <ol className="wizrail wizrail--4" aria-label="Presentment steps">
        {(
          [
            ["lookup", "1 · Lookup claim"],
            ["review", "2 · Quote cash-out"],
            ["checks", "3 · Local CIP"],
            ["done", "4 · Advance & settle"],
          ] as const
        ).map(([id, label]) => {
          const order = ["lookup", "review", "checks", "done"] as const;
          const si = order.indexOf(step);
          const ii = order.indexOf(id);
          const state = id === step ? "is-current" : ii < si ? "is-done" : "is-todo";
          return (
            <li key={id} className={`wizrail__item ${state}`}>
              <span className="wizrail__dot" aria-hidden="true" />
              <span className="wizrail__label">{label}</span>
            </li>
          );
        })}
      </ol>

      {step === "lookup" && (
        <div className="wizpanel">
          <h2 className="step">Identify the certificate</h2>
          <p className="muted small">
            Ask for the deposit id (asset name) or the issuer bank transaction id printed
            on the member&apos;s portal / wallet metadata.
          </p>
          <form onSubmit={doLookup}>
            <label className="field">
              <span>Deposit id or transaction id</span>
              <input
                value={claimRef}
                onChange={(e) => setClaimRef(e.currentTarget.value)}
                placeholder="e.g. 4 or 2"
                required
                autoComplete="off"
              />
            </label>
            {lookupError && <ErrorNote message={lookupError} />}
            <div className="wizactions">
              <button className="button" type="submit" disabled={looking || !claimRef.trim()}>
                {looking ? "Looking up…" : "Look up foreign claim"}
              </button>
            </div>
          </form>
          {history.length > 0 && (
            <>
              <h2 className="step">Recent presentments at this desk</h2>
              <ul className="present-list">
                {history.slice(0, 5).map((p) => (
                  <li key={p.id}>
                    <strong>#{p.id}</strong> {p.walkInName} · {money(p.cashOutCents)} ·{" "}
                    <span className="muted">{p.status.replaceAll("_", " ")}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {step === "review" && claim && (
        <div className="wizpanel">
          <h2 className="step">Issuer claim file</h2>
          <div className="note">
            Issued by <strong>{claim.issuerName}</strong> · holder{" "}
            <strong>{claim.holderName}</strong> · status{" "}
            <StatusBadge status={claim.claim.status} />
          </div>
          <table className="terms">
            <tbody>
              <tr>
                <th>Product</th>
                <td>{claim.claim.product.name}</td>
              </tr>
              <tr>
                <th>Principal</th>
                <td>{money(claim.claim.principalCents)}</td>
              </tr>
              <tr>
                <th>Rate</th>
                <td>{percentFromBps(claim.claim.rateBps)} APY</td>
              </tr>
              <tr>
                <th>Term (attested)</th>
                <td>
                  {claim.claim.startMs && claim.claim.maturityMs
                    ? `${date(claim.claim.startMs)} → ${date(claim.claim.maturityMs)}`
                    : "—"}
                </td>
              </tr>
              <tr>
                <th>Deposit id</th>
                <td className="mono">{claim.claim.depositId ?? "— (not attested)"}</td>
              </tr>
              <tr>
                <th>Tx / wallet</th>
                <td className="mono">
                  {claim.claim.txHash ? shortHash(claim.claim.txHash) : "no mint hash"} ·{" "}
                  {claim.holderWallet.slice(0, 18)}…
                </td>
              </tr>
              <tr>
                <th>Cash-out quote</th>
                <td>
                  {claim.redeemable && claim.cashOutCents !== null ? (
                    <>
                      <strong>{money(claim.cashOutCents)}</strong>{" "}
                      <span className="muted">
                        ({claim.cashOutMode === "mature" ? "mature redemption" : "early withdrawal net"})
                      </span>
                    </>
                  ) : (
                    <span className="fieldError">Not redeemable at this desk</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
          <ul className="disclosures">
            {claim.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          <div className="wizactions">
            <button className="button button--quiet" type="button" onClick={reset}>
              Look up another
            </button>
            <button
              className="button"
              type="button"
              disabled={!claim.redeemable}
              onClick={() => setStep("checks")}
            >
              Continue to local CIP
            </button>
          </div>
        </div>
      )}

      {step === "checks" && claim && (
        <div className="wizpanel">
          <h2 className="step">Local CIP at {meta.presentingCuName}</h2>
          <p className="muted small">
            Even though the CD lives at {claim.issuerName}, this branch must identify the
            walk-in and screen sanctions before advancing cash. This is your CIP — not a
            substitute for the issuer&apos;s.
          </p>
          <label className="field">
            <span>Walk-in legal name (must match issuer holder)</span>
            <input
              value={walkInName}
              onChange={(e) => setWalkInName(e.currentTarget.value)}
              required
            />
          </label>
          <ul className="checklist">
            <li>
              <label className="checklist__row">
                <input type="checkbox" checked={cip} onChange={(e) => setCip(e.currentTarget.checked)} />
                <span>
                  <strong>CIP / identity verified at this branch</strong>
                  <span className="checklist__detail">
                    Government ID matches walk-in name and holder on the claim file.
                  </span>
                </span>
              </label>
            </li>
            <li>
              <label className="checklist__row">
                <input
                  type="checkbox"
                  checked={ofac}
                  onChange={(e) => setOfac(e.currentTarget.checked)}
                />
                <span>
                  <strong>OFAC screening cleared (walk-in)</strong>
                  <span className="checklist__detail">
                    Screen the person receiving cash today — not only the historic issuer KYC.
                  </span>
                </span>
              </label>
            </li>
            <li>
              <label className="checklist__row">
                <input
                  type="checkbox"
                  checked={ownershipProof}
                  onChange={(e) => setOwnershipProof(e.currentTarget.checked)}
                />
                <span>
                  <strong>Wallet / CDT ownership proved</strong>
                  <span className="checklist__detail">
                    Challenge-response signature from holder wallet, or issuer recovery letter.
                    Do not pay on a screenshot alone.
                  </span>
                </span>
              </label>
            </li>
          </ul>
          <div className="note">
            You will advance <strong>{money(claim.cashOutCents ?? 0)}</strong> from this
            CU&apos;s cash, then collect settlement from {claim.issuerName}. The advance is{" "}
            <em>not</em> NCUSIF-insured as a deposit at your CU until settled.
          </div>
          {submitError && <ErrorNote message={submitError} />}
          <form onSubmit={filePresentment}>
            <div className="wizactions">
              <button
                className="button button--quiet"
                type="button"
                onClick={() => setStep("review")}
                disabled={submitting}
              >
                Back
              </button>
              <button
                className="button"
                type="submit"
                disabled={submitting || !cip || !ofac || !ownershipProof || !walkInName.trim()}
              >
                {submitting ? "Filing…" : "Advance cash & file presentment"}
              </button>
            </div>
          </form>
        </div>
      )}

      {step === "done" && ticket && (
        <div className="wizpanel">
          <h2 className="step">Presentment ticket #{ticket.id}</h2>
          <div className="note note--ok">
            <p>
              Cash advanced: <strong>{money(ticket.cashOutCents)}</strong> (
              {ticket.cashOutMode}) to <strong>{ticket.walkInName}</strong>. Status:{" "}
              <em>{ticket.status.replaceAll("_", " ")}</em>.
            </p>
          </div>
          <table className="terms">
            <tbody>
              <tr>
                <th>Presenting CU</th>
                <td>{ticket.presentingCuName}</td>
              </tr>
              <tr>
                <th>Issuer</th>
                <td>{ticket.issuerName}</td>
              </tr>
              <tr>
                <th>Deposit / tx</th>
                <td className="mono">
                  {ticket.depositId ?? "—"} / #{ticket.transactionId}
                </td>
              </tr>
              <tr>
                <th>Settlement instruction</th>
                <td>{ticket.settlement}</td>
              </tr>
            </tbody>
          </table>
          <h3>Next steps for the desk</h3>
          <ol className="disclosures" style={{ listStyle: "decimal" }}>
            {ticket.nextSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <div className="wizactions">
            <button className="button" type="button" onClick={reset}>
              New presentment
            </button>
            <a className="button button--quiet" href="#/about">
              How correspondent redemption works
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
