import { useEffect, useState } from "react";
import type { CdDto, MemberDto } from "../../shared/types.js";
import { api } from "../api.js";
import { ErrorNote, Spinner, StatusBadge, TermRuler } from "../components.js";
import { date, daysUntil, money, percentFromBps, termLabel } from "../format.js";

function CdCard({ cd }: { cd: CdDto }) {
  const maturity = cd.maturityMs;
  return (
    <a className="cert" href={`#/cd/${cd.transactionId}`}>
      <div className="cert__head">
        <h3>{cd.product.name}</h3>
        <StatusBadge status={cd.status} />
      </div>
      <p className="cert__principal">
        {money(cd.principalCents)}
        <span className="cert__apy">{percentFromBps(cd.rateBps)} APY</span>
      </p>
      <dl className="cert__facts">
        <div>
          <dt>Value today</dt>
          <dd>{money(cd.valueTodayCents)}</dd>
        </div>
        <div>
          <dt>At maturity</dt>
          <dd>
            {money(cd.maturityValueCents)}
            {cd.projectionEstimated && <span className="est"> est.</span>}
          </dd>
        </div>
        <div>
          <dt>{cd.status === "matured" ? "Matured" : "Matures"}</dt>
          <dd>
            {maturity !== null
              ? cd.status === "matured"
                ? date(maturity)
                : `${date(maturity)} · ${daysUntil(maturity)} days`
              : `~${termLabel(cd.product.termMonths)} after attestation`}
          </dd>
        </div>
      </dl>
      {cd.startMs !== null && cd.maturityMs !== null ? (
        <TermRuler start={cd.startMs} end={cd.maturityMs} />
      ) : (
        <p className="muted small">Awaiting attestation from the credit union.</p>
      )}
    </a>
  );
}

export function Dashboard({ member }: { member: MemberDto }) {
  const [cds, setCds] = useState<CdDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCds(null);
    api
      .cds(member.id)
      .then(setCds)
      .catch((err) => setError(String(err)));
  }, [member.id]);

  if (error) return <ErrorNote message={error} />;
  if (cds === null) return <Spinner label="Loading your certificates…" />;

  const totalPrincipal = cds.reduce((sum, cd) => sum + cd.principalCents, 0);
  const totalToday = cds.reduce((sum, cd) => sum + cd.valueTodayCents, 0);
  const totalAtMaturity = cds.reduce((sum, cd) => sum + cd.maturityValueCents, 0);

  return (
    <section>
      <div className="pagehead">
        <div>
          <h1 className="display">Your certificates</h1>
          <p className="lede">Share certificates held by {member.memberName}</p>
        </div>
        <a className="button" href="#/open">
          Tokenize a CD
        </a>
      </div>

      {cds.length > 0 && (
        <div className="summary">
          <div>
            <span className="summary__label">Principal on deposit</span>
            <span className="summary__value">{money(totalPrincipal)}</span>
          </div>
          <div>
            <span className="summary__label">Value today</span>
            <span className="summary__value">{money(totalToday)}</span>
          </div>
          <div>
            <span className="summary__label">Projected at maturity</span>
            <span className="summary__value">{money(totalAtMaturity)}</span>
          </div>
        </div>
      )}

      {cds.length === 0 ? (
        <div className="empty">
          <h2>No certificates yet</h2>
          <p>
            A share certificate locks in a guaranteed dividend rate for a fixed term.
            Open one in about a minute.
          </p>
          <a className="button" href="#/open">
            Tokenize a certificate
          </a>
        </div>
      ) : (
        <div className="certgrid">
          {cds.map((cd) => (
            <CdCard key={cd.transactionId} cd={cd} />
          ))}
        </div>
      )}
    </section>
  );
}
