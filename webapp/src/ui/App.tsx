import { useCallback, useEffect, useMemo, useState } from "react";
import type { MemberDto } from "../shared/types.js";
import { api } from "./api.js";
import { ErrorNote, Spinner } from "./components.js";
import { About } from "./pages/About.js";
import { CdDetail } from "./pages/CdDetail.js";
import { Dashboard } from "./pages/Dashboard.js";
import { MemberPicker } from "./pages/MemberPicker.js";
import { OpenCd } from "./pages/OpenCd.js";
import { OpenFacility } from "./pages/OpenFacility.js";
import { PresentFacility } from "./pages/PresentFacility.js";
import { FacilityOps } from "./pages/FacilityOps.js";
import { PresentForeign } from "./pages/PresentForeign.js";
import { PaymentTerminal } from "./pages/PaymentTerminal.js";
import { SignRequestPage } from "./pages/SignRequest.js";

export const BRAND_NAME = import.meta.env.VITE_BRAND_NAME || "CampusUSA Credit Union";

const MEMBER_KEY = "cdt.memberId";

type Route =
  | { page: "dashboard" }
  | { page: "cd"; txId: number }
  | { page: "open" }
  | { page: "facility" }
  | { page: "facility-present" }
  | { page: "facility-ops" }
  | { page: "present" }
  | { page: "pay" }
  | { page: "sign"; requestId?: string }
  | { page: "about" };

function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "").split("?")[0] ?? "";
  const cd = path.match(/^\/cd\/(\d+)$/);
  if (cd) return { page: "cd", txId: Number(cd[1]) };
  const sign = path.match(/^\/sign(?:\/([a-f0-9]+))?$/i);
  if (sign) return { page: "sign", requestId: sign[1] };
  if (path === "/open") return { page: "open" };
  if (path === "/facility") return { page: "facility" };
  if (path === "/facility-present") return { page: "facility-present" };
  if (path === "/facility-ops") return { page: "facility-ops" };
  if (path === "/present") return { page: "present" };
  if (path === "/pay") return { page: "pay" };
  if (path === "/about") return { page: "about" };
  return { page: "dashboard" };
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function App() {
  const route = useHashRoute();
  const [members, setMembers] = useState<MemberDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<number | null>(() => {
    const raw = window.localStorage.getItem(MEMBER_KEY);
    return raw ? Number(raw) : null;
  });

  useEffect(() => {
    api
      .members()
      .then(setMembers)
      .catch((err) => setError(`Could not reach the portal API: ${String(err)}`));
  }, []);

  const member = useMemo(
    () => members?.find((m) => m.id === memberId) ?? null,
    [members, memberId],
  );

  const selectMember = useCallback((m: MemberDto) => {
    window.localStorage.setItem(MEMBER_KEY, String(m.id));
    setMemberId(m.id);
    window.location.hash = "#/";
  }, []);

  const signOut = useCallback(() => {
    window.localStorage.removeItem(MEMBER_KEY);
    setMemberId(null);
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <a className="wordmark" href="#/">
          <span className="wordmark__seal" aria-hidden="true" />
          <span>
            <span className="wordmark__name">{BRAND_NAME}</span>
            <span className="wordmark__sub">Member portal · Share certificates</span>
          </span>
        </a>
        <nav className="topnav" aria-label="Primary">
          <a href="#/" className={route.page === "dashboard" || route.page === "cd" ? "is-active" : ""}>
            Certificates
          </a>
          <a href="#/facility" className={route.page === "facility" ? "is-active" : ""}>
            Credit facility
          </a>
          <a
            href="#/facility-present"
            className={route.page === "facility-present" ? "is-active" : ""}
          >
            Facility cash-out
          </a>
          <a href="#/open" className={route.page === "open" ? "is-active" : ""}>
            Tokenize a CD (legacy)
          </a>
          <a href="#/present" className={route.page === "present" ? "is-active" : ""}>
            Foreign CDT cash-out
          </a>
          <a href="#/pay" className={route.page === "pay" ? "is-active" : ""}>
            Payment terminal
          </a>
          <a href="#/sign" className={route.page === "sign" ? "is-active" : ""}>
            Wallet sign / QR
          </a>
          <a href="#/about" className={route.page === "about" ? "is-active" : ""}>
            How it works
          </a>
        </nav>
        {member && (
          <div className="whoami">
            <span className="whoami__name">{member.memberName}</span>
            <button className="linklike" onClick={signOut} type="button">
              Switch member
            </button>
          </div>
        )}
      </header>

      <main className="content">
        {error ? (
          <ErrorNote message={error} />
        ) : members === null ? (
          <Spinner />
        ) : route.page === "about" ? (
          <About />
        ) : route.page === "present" ? (
          <PresentForeign />
        ) : route.page === "facility-present" ? (
          <PresentFacility />
        ) : route.page === "facility-ops" ? (
          <FacilityOps />
        ) : route.page === "pay" ? (
          <PaymentTerminal />
        ) : route.page === "sign" ? (
          <SignRequestPage requestId={route.requestId} />
        ) : member === null ? (
          <MemberPicker members={members} onSelect={selectMember} />
        ) : route.page === "cd" ? (
          <CdDetail member={member} txId={route.txId} />
        ) : route.page === "facility" ? (
          <OpenFacility member={member} />
        ) : route.page === "open" ? (
          <OpenCd member={member} />
        ) : (
          <Dashboard member={member} />
        )}
      </main>

      <footer className="footer">
        <p>
          Deposits are held at the credit union and federally insured by the NCUA up to
          applicable limits. Primary product: credit-claim CDT (secured LOC against a pledged
          certificate; coupon to depositor; cash-out draws the depositor’s line). Legacy vault
          tokenize remains under “Tokenize a CD (legacy)”. Demonstration environment; not real
          accounts.
        </p>
      </footer>
    </div>
  );
}
