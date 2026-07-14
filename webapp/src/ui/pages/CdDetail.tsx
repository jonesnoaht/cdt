import { useEffect, useMemo, useState } from "react";
import type { CdDto, ChainLookupDto, MemberDto } from "../../shared/types.js";
import { api } from "../api.js";
import { ErrorNote, Spinner, StatusBadge, TermRuler } from "../components.js";
import { date, daysUntil, money, percentFromBps, shortHash, termLabel } from "../format.js";

/** SVG chart of certificate value (principal + accrued) across the term. */
function AccrualChart({ cd }: { cd: CdDto }) {
  const curve = cd.curve!;
  const width = 640;
  const height = 180;
  const pad = { top: 12, right: 12, bottom: 24, left: 64 };

  const t0 = curve[0]!.tMs;
  const t1 = curve[curve.length - 1]!.tMs;
  const v0 = cd.principalCents;
  const v1 = cd.maturityValueCents;
  const x = (t: number) => pad.left + ((t - t0) / (t1 - t0)) * (width - pad.left - pad.right);
  const y = (v: number) =>
    v1 === v0
      ? height - pad.bottom
      : height - pad.bottom - ((v - v0) / (v1 - v0)) * (height - pad.top - pad.bottom);

  const valuePath = curve
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.tMs).toFixed(1)},${y(v0 + p.accruedCents).toFixed(1)}`)
    .join(" ");
  const nowMs = Math.min(Math.max(Date.now(), t0), t1);
  const nowValue = v0 + (cd.status === "matured" ? cd.maturityValueCents - v0 : cd.accruedTodayCents);

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Certificate value over the term">
        {[v0, (v0 + v1) / 2, v1].map((v) => (
          <g key={v}>
            <line className="chart__grid" x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} />
            <text className="chart__tick" x={pad.left - 8} y={y(v) + 4} textAnchor="end">
              {money(Math.round(v))}
            </text>
          </g>
        ))}
        <path className="chart__line" d={valuePath} />
        <line className="chart__today" x1={x(nowMs)} x2={x(nowMs)} y1={pad.top} y2={height - pad.bottom} />
        <circle className="chart__dot" cx={x(nowMs)} cy={y(nowValue)} r={4} />
        <text className="chart__tick" x={pad.left} y={height - 6}>
          {date(t0)}
        </text>
        <text className="chart__tick" x={width - pad.right} y={height - 6} textAnchor="end">
          {date(t1)}
        </text>
      </svg>
      <figcaption className="muted small">
        Dividends accrue daily at a fixed {percentFromBps(cd.rateBps)} APY; the marker shows today.
      </figcaption>
    </figure>
  );
}

/** Early-withdrawal calculator: slide a date across the term. */
function WithdrawalCalculator({ cd }: { cd: CdDto }) {
  const curve = cd.curve!;
  const nowMs = Date.now();
  const defaultIndex = useMemo(() => {
    const i = curve.findIndex((p) => p.tMs >= nowMs);
    return i === -1 ? curve.length - 1 : i;
  }, [curve, nowMs]);
  const [index, setIndex] = useState(defaultIndex);
  const point = curve[Math.min(index, curve.length - 1)]!;
  const isMaturity = index >= curve.length - 1;
  const payout = isMaturity ? cd.maturityValueCents : point.earlyPayoutCents;
  const forgone = cd.maturityValueCents - payout;

  return (
    <div className="calc">
      <h3>What if I withdraw early?</h3>
      <p className="muted">
        Withdrawing before maturity forfeits {percentFromBps(cd.penaltyBps)} of the dividends
        accrued so far. Slide to any date in the term:
      </p>
      <input
        type="range"
        min={0}
        max={curve.length - 1}
        value={index}
        onChange={(e) => setIndex(Number(e.currentTarget.value))}
        aria-label="Withdrawal date"
      />
      <div className="calc__date">
        Withdraw on <strong>{date(point.tMs)}</strong>
        {isMaturity && " (maturity)"}
      </div>
      <dl className="calc__rows">
        <div>
          <dt>Principal</dt>
          <dd>{money(cd.principalCents)}</dd>
        </div>
        <div>
          <dt>Dividends accrued</dt>
          <dd>+{money(point.accruedCents)}</dd>
        </div>
        <div className={isMaturity ? "is-zero" : "is-penalty"}>
          <dt>Early-withdrawal penalty</dt>
          <dd>−{money(isMaturity ? 0 : point.penaltyCents)}</dd>
        </div>
        <div className="calc__total">
          <dt>You would receive</dt>
          <dd>{money(payout)}</dd>
        </div>
        <div>
          <dt>Held to maturity instead</dt>
          <dd>
            {money(cd.maturityValueCents)}
            {forgone > 0 && <span className="est"> ({money(forgone)} more)</span>}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function ChainStatus({ cd }: { cd: CdDto }) {
  const [lookup, setLookup] = useState<ChainLookupDto | null | "loading">(null);

  const check = () => {
    setLookup("loading");
    api
      .chain(cd.depositId ?? cd.transactionId)
      .then(setLookup)
      .catch((err) => setLookup({ available: false, reason: String(err) }));
  };

  return (
    <div className="chainbox">
      <h3>Certificate token</h3>
      {cd.status === "pending" ? (
        <p className="muted">
          Once the credit union attests this deposit, a certificate token is minted on the
          Cardano test network as its on-chain record.
        </p>
      ) : cd.txHash ? (
        <p className="muted">
          Minted in transaction{" "}
          <a href={cd.explorerUrl!} target="_blank" rel="noreferrer" className="mono">
            {shortHash(cd.txHash)}
          </a>{" "}
          on the Cardano preview network.
        </p>
      ) : (
        <p className="muted">
          This certificate is attested; its token mint has not been recorded here yet.
        </p>
      )}
      {cd.status !== "pending" && (
        <>
          <button className="button button--quiet" onClick={check} type="button">
            Check on-chain status
          </button>
          {lookup === "loading" ? (
            <Spinner label="Querying the chain…" />
          ) : lookup?.available ? (
            <p className="note note--ok">
              Confirmed on chain.{" "}
              {lookup.explorerUrl && (
                <a href={lookup.explorerUrl} target="_blank" rel="noreferrer">
                  View in explorer
                </a>
              )}
            </p>
          ) : lookup ? (
            <p className="note">{lookup.reason ?? "On-chain status unavailable."}</p>
          ) : null}
        </>
      )}
    </div>
  );
}

export function CdDetail({ member, txId }: { member: MemberDto; txId: number }) {
  const [cds, setCds] = useState<CdDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .cds(member.id)
      .then(setCds)
      .catch((err) => setError(String(err)));
  }, [member.id]);

  if (error) return <ErrorNote message={error} />;
  if (cds === null) return <Spinner label="Loading certificate…" />;

  const cd = cds.find((c) => c.transactionId === txId);
  if (!cd) {
    return (
      <ErrorNote message="Certificate not found for this member. It may belong to a different login." />
    );
  }

  return (
    <section>
      <p>
        <a href="#/" className="crumb">
          ← All certificates
        </a>
      </p>
      <div className="pagehead">
        <div>
          <h1 className="display">{cd.product.name}</h1>
          <p className="lede">
            Opened {date(cd.createdAt)} · Certificate no. {cd.depositId ?? `—${cd.transactionId} (pending)`}
          </p>
        </div>
        <StatusBadge status={cd.status} />
      </div>

      <div className="figures">
        <div>
          <span className="summary__label">Principal</span>
          <span className="summary__value">{money(cd.principalCents)}</span>
        </div>
        <div>
          <span className="summary__label">Value today</span>
          <span className="summary__value">{money(cd.valueTodayCents)}</span>
        </div>
        <div>
          <span className="summary__label">At maturity{cd.projectionEstimated ? " (est.)" : ""}</span>
          <span className="summary__value">{money(cd.maturityValueCents)}</span>
        </div>
        <div>
          <span className="summary__label">Dividend rate</span>
          <span className="summary__value">{percentFromBps(cd.rateBps)} APY</span>
        </div>
      </div>

      {cd.status === "pending" ? (
        <div className="note">
          <strong>Pending attestation.</strong> Your deposit is at the credit union and the
          certificate terms are locked in. The credit union's oracle will attest it shortly;
          projections shown are estimates from the deposit date.
        </div>
      ) : (
        <>
          {cd.startMs !== null && cd.maturityMs !== null && (
            <div className="detail-ruler">
              <TermRuler start={cd.startMs} end={cd.maturityMs} />
              <div className="detail-ruler__ends muted small">
                <span>{date(cd.startMs)}</span>
                <span>
                  {cd.status === "matured"
                    ? "Matured — full dividend earned"
                    : `Matures ${date(cd.maturityMs)} (${daysUntil(cd.maturityMs)} days)`}
                </span>
              </div>
            </div>
          )}
          {cd.curve && <AccrualChart cd={cd} />}
          {cd.curve && cd.status === "active" && <WithdrawalCalculator cd={cd} />}
        </>
      )}

      <h3>Certificate terms</h3>
      <table className="terms">
        <tbody>
          <tr>
            <th>Term</th>
            <td>{termLabel(cd.product.termMonths)}</td>
          </tr>
          <tr>
            <th>Dividend rate (APY)</th>
            <td>{percentFromBps(cd.rateBps)} — simple interest, paid at maturity</td>
          </tr>
          <tr>
            <th>Early-withdrawal penalty</th>
            <td>{percentFromBps(cd.penaltyBps)} of accrued dividends</td>
          </tr>
          <tr>
            <th>Term begins</th>
            <td>{cd.startMs !== null ? date(cd.startMs) : "On attestation"}</td>
          </tr>
          <tr>
            <th>Maturity date</th>
            <td>
              {cd.maturityMs !== null
                ? date(cd.maturityMs)
                : `~${termLabel(cd.product.termMonths)} after attestation`}
            </td>
          </tr>
          <tr>
            <th>Minimum deposit</th>
            <td>{money(cd.product.minDepositCents)}</td>
          </tr>
        </tbody>
      </table>

      <ChainStatus cd={cd} />
    </section>
  );
}
