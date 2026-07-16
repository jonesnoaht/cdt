/**
 * Cash-out desk: presenter receives money; original depositor's LOC is drawn.
 */
import { useEffect, useState, type FormEvent } from "react";
import { ApiRequestError, api, type FacilityDto, type FacilityPresentmentDto } from "../api.js";
import { ErrorNote, Spinner } from "../components.js";
import { money } from "../format.js";

function facilityIdFromHash(): number | null {
  const q = window.location.hash.split("?")[1];
  if (!q) return null;
  const id = new URLSearchParams(q).get("id");
  return id ? Number(id) : null;
}

export function PresentFacility() {
  const [facilityIdText, setFacilityIdText] = useState(() => {
    const id = facilityIdFromHash();
    return id != null ? String(id) : "";
  });
  const [facility, setFacility] = useState<FacilityDto | null>(null);
  const [amountText, setAmountText] = useState("100");
  const [presenterWallet, setPresenterWallet] = useState("addr_holder_demo");
  const [cipOk, setCipOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FacilityPresentmentDto | null>(null);

  useEffect(() => {
    const id = Number(facilityIdText);
    if (!Number.isInteger(id) || id <= 0) {
      setFacility(null);
      return;
    }
    api
      .getFacility(id)
      .then(setFacility)
      .catch(() => setFacility(null));
  }, [facilityIdText]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const facilityId = Number(facilityIdText);
    const dollars = Number(amountText);
    if (!Number.isInteger(facilityId) || facilityId <= 0) {
      setError("Enter a valid facility id.");
      return;
    }
    if (!cipOk) {
      setError("CIP/OFAC check required at cash-out.");
      return;
    }
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError("Enter a positive amount.");
      return;
    }
    const amountCents = Math.round(dollars * 100);
    setBusy(true);
    try {
      const req = await api.requestFacilityPresentment(facilityId, {
        amountCents,
        presenterWallet,
        presenterName: "Walk-in presenter",
        cipRef: "cip-desk-ok",
      });
      const paid = await api.payFacilityPresentment(req.id);
      const burned = await api.burnFacilityPresentment(
        paid.id,
        `demo_burn_${paid.id}_${Date.now()}`,
      );
      setResult(burned);
      setFacility(await api.getFacility(facilityId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h1>Facility CDT cash-out</h1>
      <p className="lede">
        You receive cash or account credit. <strong>You are not borrowing.</strong> The original
        depositor’s secured line is drawn. CDT is not an insured deposit token.
      </p>

      <form onSubmit={onSubmit} className="form-stack">
        {error && <ErrorNote message={error} />}
        <label>
          Facility id
          <input
            type="number"
            value={facilityIdText}
            onChange={(e) => setFacilityIdText(e.target.value)}
          />
        </label>
        {facility ? (
          <p className="muted">
            Available {money(facility.availableCents)} · Drawn {money(facility.drawnCents)} · Supply{" "}
            {money(facility.onChainSupplyCents)} · Status {facility.status}
          </p>
        ) : (
          facilityIdText && <Spinner label="Loading facility…" />
        )}
        <label>
          Amount (USD)
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
          />
        </label>
        <label>
          Presenter wallet
          <input
            type="text"
            value={presenterWallet}
            onChange={(e) => setPresenterWallet(e.target.value)}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={cipOk}
            onChange={(e) => setCipOk(e.target.checked)}
          />
          CIP / OFAC cleared for presenter (desk stub)
        </label>
        <button type="submit" disabled={busy || !facility}>
          {busy ? "Processing…" : "Request → pay → burn (demo)"}
        </button>
      </form>

      {result && (
        <div className="note note--ok">
          <p>
            Presentment #{result.id} · {result.status} · {money(result.amountCents)}
            {result.burnTxHash ? (
              <>
                {" "}
                · burn <code>{result.burnTxHash}</code>
              </>
            ) : null}
          </p>
        </div>
      )}
    </section>
  );
}
