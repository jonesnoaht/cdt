import type { MemberDto } from "../../shared/types.js";

/** Demo login: pick which seeded member to browse as. */
export function MemberPicker({
  members,
  onSelect,
}: {
  members: MemberDto[];
  onSelect: (m: MemberDto) => void;
}) {
  return (
    <section className="picker">
      <h1 className="display">Welcome back</h1>
      <p className="lede">
        This is a demonstration portal — choose a member to sign in as.
      </p>
      {members.length === 0 ? (
        <div className="note">
          No members found. Seed the core-banking database first (see the README).
        </div>
      ) : (
        <ul className="picker__list">
          {members.map((m) => (
            <li key={m.id}>
              <button className="picker__member" onClick={() => onSelect(m)} type="button">
                <span className="picker__avatar" aria-hidden="true">
                  {m.memberName
                    .split(" ")
                    .map((part) => part[0])
                    .join("")
                    .slice(0, 2)}
                </span>
                <span className="picker__meta">
                  <strong>{m.memberName}</strong>
                  <span className="muted mono">{m.walletAddress.slice(0, 24)}…</span>
                </span>
                <span className="picker__go" aria-hidden="true">
                  →
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
