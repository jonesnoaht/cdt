/** Small shared presentational components. */
import type { CdStatus } from "../shared/types.js";
import { progress } from "./format.js";

const STATUS_LABEL: Record<CdStatus, string> = {
  pending: "Pending attestation",
  active: "Active",
  matured: "Matured",
};

export function StatusBadge({ status }: { status: CdStatus }) {
  return <span className={`badge badge--${status}`}>{STATUS_LABEL[status]}</span>;
}

/**
 * The "term ruler": a thin ticked track showing how far a certificate has
 * progressed through its term.
 */
export function TermRuler({
  start,
  end,
  now,
}: {
  start: number;
  end: number;
  now?: number;
}) {
  const p = progress(start, end, now);
  return (
    <div
      className="ruler"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(p * 100)}
      aria-label="Term progress"
    >
      <div className="ruler__fill" style={{ width: `${p * 100}%` }} />
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return <p className="muted loading">{label}</p>;
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="note note--error" role="alert">
      {message}
    </div>
  );
}
