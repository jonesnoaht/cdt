/**
 * Issuer ops: maturity waterfall and optional re-issue.
 */
import { useEffect, useState, type FormEvent } from "react";
import { ApiRequestError, api, type FacilityDto } from "../api.js";
import { ErrorNote, Spinner } from "../components.js";
import { money } from "../format.js";

function facilityIdFromHash(): number | null {
  const q = window.location.hash.split("?")[1];
  if (!q) return null;
  const id = new URLSearchParams(q).get("id");
  return id ? Number(id) : null;
}

export function FacilityOps() {
  const [facilityIdText, setFacilityIdText] = useState(() => {
    const id = facilityIdFromHash();
    return id != null ? String(id) : "";
  });
  const [facility, setFacility] = useState<FacilityDto | null>(null);
  const [termMonths, setTermMonths] = useState(12);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function reload(id: number) {
    setFacility(await api.getFacility(id));
  }

  useEffect(() => {
    const id = Number(facilityIdText);
    if (!Number.isInteger(id) || id <= 0) {
      setFacility(null);
      return;
    }
    reload(id).catch(() => setFacility(null));
  }, [facilityIdText]);

  async function onWaterfall(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const id = Number(facilityIdText);
    setBusy(true);
    try {
      await api.facilityWaterfall(id);
      await reload(id);
      setMessage("Maturity waterfall completed. Facility should be closed; CDT supply cleared.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onReissue(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!facility) return;
    setBusy(true);
    try {
      const next = await api.facilityReissue(facility.id, {
        newTermMonths: termMonths,
        currentOnChainSupplyCents: facility.onChainSupplyCents,
      });
      setFacility(next);
      setMessage(`Re-issue ok. New limit ${money(next.limitCents)}; status ${next.status}.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h1>Facility issuer ops</h1>
      <p className="lede">
        Default maturity path is the waterfall (pay LOC, then CDT holders, residual to depositor).
        Rollover requires dual opt-in and supply ≤ new limit — no silent perpetual float.
      </p>

      <label>
        Facility id
        <input
          type="number"
          value={facilityIdText}
          onChange={(e) => setFacilityIdText(e.target.value)}
        />
      </label>

      {error && <ErrorNote message={error} />}
      {message && <div className="note note--ok">{message}</div>}
      {facilityIdText && !facility && <Spinner label="Loading facility…" />}
      {facility && (
        <p className="muted">
          Status {facility.status} · Limit {money(facility.limitCents)} · Drawn{" "}
          {money(facility.drawnCents)} · Supply {money(facility.onChainSupplyCents)}
        </p>
      )}

      <form onSubmit={onWaterfall} className="form-stack">
        <button type="submit" disabled={busy || !facility}>
          Run maturity waterfall
        </button>
      </form>

      <form onSubmit={onReissue} className="form-stack">
        <label>
          New term (months)
          <input
            type="number"
            min={1}
            value={termMonths}
            onChange={(e) => setTermMonths(Number(e.target.value))}
          />
        </label>
        <button type="submit" disabled={busy || !facility}>
          Optional re-issue (extend)
        </button>
      </form>
    </section>
  );
}
