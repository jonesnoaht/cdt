import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  CdDto,
  DepositResponse,
  MemberDto,
  ProductDto,
  TokenizePrepDto,
} from "../../shared/types.js";
import { ApiRequestError, api } from "../api.js";
import { ErrorNote, Spinner, StatusBadge } from "../components.js";
import { money, percentFromBps, shortHash, termLabel } from "../format.js";
import {
  detectCip30Wallets,
  type Cip30WalletApi,
} from "../cip30.js";

type WizardStep = "cip" | "product" | "disclosures" | "confirm" | "track";

const STEP_ORDER: WizardStep[] = ["cip", "product", "disclosures", "confirm", "track"];

const STEP_LABEL: Record<WizardStep, string> = {
  cip: "1 · Login & Lace wallet",
  product: "2 · Product & amount",
  disclosures: "3 · Disclosures",
  confirm: "4 · Book on core",
  track: "5 · Deliver certificate",
};

function truncateMiddle(value: string, head = 14, tail = 10): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function pipelineStages(
  cd: CdDto | null,
  booked: boolean,
): Array<{ id: string; label: string; done: boolean; current: boolean }> {
  const status = cd?.status;
  const isActive = status === "active";
  const isMatured = status === "matured";
  const hasDepositId = Boolean(cd?.depositId);
  const hasTx = Boolean(cd?.txHash);

  const stages = [
    {
      id: "booked",
      label: "Deposit booked on core",
      done: booked || Boolean(cd),
      current: false,
    },
    {
      id: "attest",
      label: "Oracle attests (VC chain + deposit)",
      done: hasDepositId || isActive || isMatured,
      current: false,
    },
    {
      id: "mint",
      label: "CDT minted · certificate under member wallet keys",
      done: hasTx || isActive || isMatured,
      current: false,
    },
    {
      id: "live",
      label: isMatured ? "Matured — redeem in Lace" : "Active — hold / spend from wallet",
      done: isActive || isMatured,
      current: false,
    },
  ];

  let foundCurrent = false;
  for (const s of stages) {
    if (!s.done && !foundCurrent) {
      s.current = true;
      foundCurrent = true;
    }
  }
  if (!foundCurrent && stages.length > 0) {
    stages[stages.length - 1]!.current = true;
  }
  return stages;
}

export function OpenCd({ member }: { member: MemberDto }) {
  const [step, setStep] = useState<WizardStep>("cip");
  const [prep, setPrep] = useState<TokenizePrepDto | null>(null);
  const [products, setProducts] = useState<ProductDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [productId, setProductId] = useState<number | null>(null);
  const [amountText, setAmountText] = useState("");
  const [acceptedDisclosures, setAcceptedDisclosures] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [opened, setOpened] = useState<DepositResponse | null>(null);
  const [trackedCd, setTrackedCd] = useState<CdDto | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);

  /** Lace / CIP-30 destination wallet for certificate control (ids only — no plugin objects in state). */
  const [walletOptions, setWalletOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [walletId, setWalletId] = useState("lace");
  const [laceAddress, setLaceAddress] = useState<string | null>(null);
  const [laceNetworkId, setLaceNetworkId] = useState<number | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletConfirmed, setWalletConfirmed] = useState(false);

  const refreshWallets = useCallback(() => {
    try {
      const list = detectCip30Wallets();
      setWalletOptions(list.map((w) => ({ id: w.id, label: w.label })));
      if (list.some((w) => w.id === "lace")) setWalletId("lace");
      else if (list[0]) setWalletId(list[0].id);
    } catch (err) {
      setWalletError(
        `Wallet detection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      setWalletOptions([]);
    }
  }, []);

  useEffect(() => {
    refreshWallets();
    const t = window.setTimeout(refreshWallets, 800);
    return () => window.clearTimeout(t);
  }, [refreshWallets]);

  const connectDestinationWallet = async () => {
    setWalletBusy(true);
    setWalletError(null);
    try {
      const list = detectCip30Wallets();
      if (list.length === 0) {
        setWalletError(
          "No CIP-30 wallet found. Install Lace (lace.io), enable the extension for this site, then retry.",
        );
        return;
      }
      const pick =
        list.find((w) => w.id === walletId) ??
        list.find((w) => w.id === "lace") ??
        list[0]!;
      const apiWallet: Cip30WalletApi = await pick.plugin.enable();
      const change = await apiWallet.getChangeAddress();
      const net = await apiWallet.getNetworkId();
      setLaceAddress(change);
      setLaceNetworkId(net);
      setWalletId(pick.id);
      // Soft match: core seed wallets may be bech32; CIP-30 often returns hex. Confirm explicitly.
      setWalletConfirmed(false);
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : String(err));
    } finally {
      setWalletBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.tokenizePrep(member.id), api.products()])
      .then(([prepBody, productBody]) => {
        if (cancelled) return;
        setPrep(prepBody);
        setProducts(productBody);
        const initial: Record<string, boolean> = {};
        for (const c of prepBody.checks) initial[c.id] = false;
        setChecked(initial);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [member.id]);

  const product = useMemo(
    () => products?.find((p) => p.id === productId) ?? null,
    [products, productId],
  );

  const amountCents = useMemo(() => {
    const trimmed = amountText.replace(/[$,\s]/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
    return Math.round(Number(trimmed) * 100);
  }, [amountText]);

  const amountProblem =
    amountText === ""
      ? null
      : amountCents === null
        ? "Enter a dollar amount, like 250000 or 250000.00."
        : product && amountCents < product.minDepositCents
          ? `The minimum for this certificate is ${money(product.minDepositCents)}.`
          : null;

  const allChecksDone = useMemo(
    () => (prep ? prep.checks.every((c) => checked[c.id]) : false),
    [prep, checked],
  );

  const walletReady = Boolean(laceAddress) && walletConfirmed;

  const productReady =
    product !== null && amountCents !== null && amountProblem === null && prep?.hasCdFunding === true;

  const go = (next: WizardStep) => setStep(next);

  const stepIndex = STEP_ORDER.indexOf(step);

  const bookDeposit = async (e: FormEvent) => {
    e.preventDefault();
    if (!productReady || !product || amountCents === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api.openCd(member.id, { productId: product.id, amountCents });
      setOpened(res);
      setStep("track");
    } catch (err) {
      setSubmitError(err instanceof ApiRequestError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const refreshTrack = useCallback(async () => {
    if (!opened) return;
    try {
      const cds = await api.cds(member.id);
      const match = cds.find((cd) => cd.transactionId === opened.transactionId) ?? null;
      setTrackedCd(match);
      setTrackError(null);
    } catch (err) {
      setTrackError(String(err));
    }
  }, [member.id, opened]);

  useEffect(() => {
    if (step !== "track" || !opened) return;
    void refreshTrack();
    const id = window.setInterval(() => void refreshTrack(), 2500);
    return () => window.clearInterval(id);
  }, [step, opened, refreshTrack]);

  if (loadError) return <ErrorNote message={loadError} />;
  if (prep === null || products === null) {
    return <Spinner label="Loading bank desk tokenization flow…" />;
  }

  const stages = pipelineStages(trackedCd, opened !== null);
  const atInsuranceCap =
    amountCents !== null && amountCents >= prep.insuranceLimitCents;

  return (
    <section className="openflow openflow--desk">
      <h1 className="display">Buy a CD — hold the certificate in Lace</h1>
      <p className="lede">
        Product position: the member logs into their <strong>credit union</strong> account, buys a
        share certificate as <strong>CDT</strong>, and controls it from a browser wallet (
        <strong>Lace</strong> preferred via CIP-30). Dollars stay on the CU core; the token is the
        portable certificate.
      </p>

      <ol className="wizrail" aria-label="Tokenization steps">
        {STEP_ORDER.map((s, i) => {
          const state =
            s === step ? "is-current" : i < stepIndex ? "is-done" : "is-todo";
          return (
            <li key={s} className={`wizrail__item ${state}`}>
              <span className="wizrail__dot" aria-hidden="true" />
              <span className="wizrail__label">{STEP_LABEL[s]}</span>
            </li>
          );
        })}
      </ol>

      {step === "cip" && (
        <div className="wizpanel">
          <h2 className="step">Credit union member session</h2>
          <p className="muted small">
            Demo: member is selected in the portal. Production: authenticated online-banking / desk
            SSO. This is the CU front door—not a public crypto exchange.
          </p>
          <dl className="idcard">
            <div>
              <dt>Member</dt>
              <dd>{prep.member.memberName}</dd>
            </div>
            <div>
              <dt>DID</dt>
              <dd className="mono" title={prep.member.did}>
                {truncateMiddle(prep.member.did, 18, 12)}
              </dd>
            </div>
            <div>
              <dt>Core wallet (system of record)</dt>
              <dd className="mono" title={prep.member.walletAddress}>
                {truncateMiddle(prep.member.walletAddress, 16, 10)}
              </dd>
            </div>
            <div>
              <dt>CD funding account</dt>
              <dd>
                {prep.hasCdFunding ? (
                  <>
                    #{prep.cdFundingAccountId} · balance{" "}
                    {money(
                      prep.accounts.find((a) => a.kind === "cd_funding")?.balanceCents ?? 0,
                    )}
                  </>
                ) : (
                  <span className="fieldError">Missing — cannot tokenize</span>
                )}
              </dd>
            </div>
          </dl>

          <h2 className="step">Destination wallet (Lace)</h2>
          <p className="muted small">
            Connect the browser wallet that will <strong>control</strong> the certificate after
            mint (redeem / free-spend / payment-check). Preferred:{" "}
            <a href="https://www.lace.io/" target="_blank" rel="noreferrer">
              Lace
            </a>{" "}
            via CIP-30.
          </p>
          {walletError && <ErrorNote message={walletError} />}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
            <label>
              Wallet
              <select value={walletId} onChange={(e) => setWalletId(e.target.value)}>
                {walletOptions.length === 0 && <option value="lace">Lace (not detected)</option>}
                {walletOptions.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                    {w.id === "lace" ? " ★" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button secondary"
              disabled={walletBusy}
              onClick={() => refreshWallets()}
            >
              Refresh
            </button>
            <button
              type="button"
              className="button"
              disabled={walletBusy}
              onClick={() => void connectDestinationWallet()}
            >
              {walletBusy ? "Connecting…" : "Connect Lace / wallet"}
            </button>
          </div>
          {laceAddress && (
            <dl className="idcard" style={{ marginTop: "1rem" }}>
              <div>
                <dt>Connected wallet</dt>
                <dd>{walletId}</dd>
              </div>
              <div>
                <dt>Change address</dt>
                <dd className="mono" title={laceAddress}>
                  {truncateMiddle(laceAddress, 18, 12)}
                </dd>
              </div>
              <div>
                <dt>Network id</dt>
                <dd>{laceNetworkId === 1 ? "mainnet (1)" : laceNetworkId === 0 ? "testnet (0)" : String(laceNetworkId)}</dd>
              </div>
            </dl>
          )}
          <label className="checklist__row" style={{ marginTop: "0.75rem" }}>
            <input
              type="checkbox"
              checked={walletConfirmed}
              disabled={!laceAddress}
              onChange={(e) => {
                const next = e.target.checked;
                setWalletConfirmed(next);
              }}
            />
            <span>
              <strong>Deliver certificate control to this wallet</strong>
              <span className="checklist__detail">
                Member understands the CDT is controlled with these keys (Lace). Core still holds
                the deposit; NCUSIF (if any) is on the share certificate, not the wallet app.
              </span>
            </span>
          </label>

          <h2 className="step">CIP / compliance checklist</h2>
          <p className="muted small">
            Demo stand-in for the core CIP file. In production these flags come from the
            BSA program; the credential is issued only after CIP passes.
          </p>
          <ul className="checklist">
            {prep.checks.map((c) => (
              <li key={c.id}>
                <label className="checklist__row">
                  <input
                    type="checkbox"
                    checked={Boolean(checked[c.id])}
                    onChange={(e) => {
                      // Read the value during the event — never inside a setState
                      // updater (React may re-run updaters; currentTarget is then null
                      // and throws → blank page).
                      const next = e.target.checked;
                      setChecked((prev) => ({ ...prev, [c.id]: next }));
                    }}
                  />
                  <span>
                    <strong>{c.label}</strong>
                    <span className="checklist__detail">{c.detail}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <div className="wizactions">
            <button
              className="button"
              type="button"
              disabled={!allChecksDone || !prep.hasCdFunding || !walletReady}
              onClick={() => go("product")}
            >
              Continue to product
            </button>
          </div>
          {!walletReady && (
            <p className="muted small" style={{ marginTop: "0.5rem" }}>
              Connect Lace (or another CIP-30 wallet) and confirm delivery to continue.
            </p>
          )}
        </div>
      )}

      {step === "product" && (
        <div className="wizpanel">
          <h2 className="step">Choose term</h2>
          <div className="products" role="radiogroup" aria-label="Certificate products">
            {products.map((p) => (
              <label
                key={p.id}
                className={`product ${productId === p.id ? "is-selected" : ""}`}
              >
                <input
                  type="radio"
                  name="product"
                  checked={productId === p.id}
                  onChange={() => setProductId(p.id)}
                />
                <span className="product__apy">{percentFromBps(p.rateBps)}</span>
                <span className="product__apylabel">APY</span>
                <span className="product__name">{p.name}</span>
                <span className="product__meta">
                  {termLabel(p.termMonths)} · {money(p.minDepositCents)} minimum
                </span>
              </label>
            ))}
          </div>

          <h2 className="step">Deposit amount</h2>
          <div className="presets" role="group" aria-label="Amount presets">
            {prep.amountPresetsCents.map((cents) => (
              <button
                key={cents}
                type="button"
                className={`chip ${amountCents === cents ? "is-selected" : ""}`}
                onClick={() => setAmountText((cents / 100).toFixed(2))}
              >
                {money(cents)}
              </button>
            ))}
          </div>
          <div className="amount amount--wide">
            <span className="amount__symbol" aria-hidden="true">
              $
            </span>
            <input
              inputMode="decimal"
              placeholder={product ? (product.minDepositCents / 100).toFixed(2) : "0.00"}
              value={amountText}
              onChange={(e) => setAmountText(e.currentTarget.value)}
              aria-label="Deposit amount in dollars"
            />
          </div>
          {amountProblem && <p className="fieldError">{amountProblem}</p>}
          {atInsuranceCap && !amountProblem && (
            <div className="note">
              <strong>{money(amountCents!)}</strong> is at or above the standard NCUA
              insurance ceiling of {money(prep.insuranceLimitCents)} per member, per
              ownership category. Confirm other balances and ownership category before
              closing. The <em>deposit</em> may be insured; the <em>token</em> is not.
            </div>
          )}
          <p className="muted small">
            Funds are recorded on the CD funding account at the credit union. Nothing is
            sent to a blockchain address as value transfer.
          </p>

          <div className="wizactions">
            <button className="button button--quiet" type="button" onClick={() => go("cip")}>
              Back
            </button>
            <button
              className="button"
              type="button"
              disabled={!productReady}
              onClick={() => go("disclosures")}
            >
              Continue to disclosures
            </button>
          </div>
        </div>
      )}

      {step === "disclosures" && product && amountCents !== null && (
        <div className="wizpanel">
          <h2 className="step">Member disclosures</h2>
          <div className="note">
            Opening <strong>{product.name}</strong> for <strong>{money(amountCents)}</strong>{" "}
            at {percentFromBps(product.rateBps)} APY · {termLabel(product.termMonths)} · early
            withdrawal penalty {percentFromBps(product.penaltyBps)} of accrued dividends.
          </div>
          <ul className="disclosures">
            {prep.disclosures.map((d) => (
              <li key={d.id}>{d.text}</li>
            ))}
          </ul>
          <label className="checklist__row checklist__row--solo">
            <input
              type="checkbox"
              checked={acceptedDisclosures}
              onChange={(e) => setAcceptedDisclosures(e.target.checked)}
            />
            <span>
              <strong>Member (or authorized staff) acknowledges disclosures</strong>
              <span className="checklist__detail">
                Demo checkbox — production uses E-SIGN consent and Part 707 delivery proof.
              </span>
            </span>
          </label>
          <div className="wizactions">
            <button
              className="button button--quiet"
              type="button"
              onClick={() => go("product")}
            >
              Back
            </button>
            <button
              className="button"
              type="button"
              disabled={!acceptedDisclosures}
              onClick={() => go("confirm")}
            >
              Continue to book deposit
            </button>
          </div>
        </div>
      )}

      {step === "confirm" && product && amountCents !== null && (
        <div className="wizpanel">
          <h2 className="step">Book on core ledger</h2>
          <p className="muted">
            This writes a CD-funding deposit transaction in bank-sim (system of record).
            The oracle / issuance pipeline will pick it up — you do not mint from the
            teller screen.
          </p>
          <table className="terms">
            <tbody>
              <tr>
                <th>Member</th>
                <td>{member.memberName}</td>
              </tr>
              <tr>
                <th>Product</th>
                <td>
                  {product.name} · {percentFromBps(product.rateBps)} APY
                </td>
              </tr>
              <tr>
                <th>Principal</th>
                <td>{money(amountCents)}</td>
              </tr>
              <tr>
                <th>Funding account</th>
                <td>#{prep.cdFundingAccountId}</td>
              </tr>
              <tr>
                <th>Member DID</th>
                <td className="mono">{truncateMiddle(member.did, 20, 12)}</td>
              </tr>
              <tr>
                <th>Wallet</th>
                <td className="mono">{truncateMiddle(member.walletAddress, 18, 10)}</td>
              </tr>
            </tbody>
          </table>
          {submitError && <ErrorNote message={submitError} />}
          <form onSubmit={bookDeposit}>
            <div className="wizactions">
              <button
                className="button button--quiet"
                type="button"
                onClick={() => go("disclosures")}
                disabled={submitting}
              >
                Back
              </button>
              <button className="button" type="submit" disabled={submitting}>
                {submitting ? "Booking…" : "Book deposit on core"}
              </button>
            </div>
          </form>
        </div>
      )}

      {step === "track" && opened && (
        <div className="wizpanel">
          <h2 className="step">Issuance pipeline</h2>
          <div className="note note--ok">
            <p>
              Core deposit <strong>#{opened.transactionId}</strong> booked for{" "}
              <strong>{money(opened.amountCents)}</strong>. Status starts as{" "}
              <em>pending</em> until the oracle attests and the mint pipeline tokenizes.
            </p>
          </div>

          <ol className="pipeline">
            {stages.map((s) => (
              <li
                key={s.id}
                className={
                  s.done ? "is-done" : s.current ? "is-current" : "is-todo"
                }
              >
                <span className="pipeline__mark" aria-hidden="true" />
                <span>{s.label}</span>
              </li>
            ))}
          </ol>

          {trackedCd ? (
            <div className="trackcard">
              <div className="trackcard__head">
                <h3>{trackedCd.product.name}</h3>
                <StatusBadge status={trackedCd.status} />
              </div>
              <dl className="cert__facts">
                <div>
                  <dt>Principal</dt>
                  <dd>{money(trackedCd.principalCents)}</dd>
                </div>
                <div>
                  <dt>Deposit id</dt>
                  <dd className="mono">{trackedCd.depositId ?? "—"}</dd>
                </div>
                <div>
                  <dt>Mint tx</dt>
                  <dd className="mono">
                    {trackedCd.txHash ? shortHash(trackedCd.txHash) : "awaiting pipeline"}
                  </dd>
                </div>
                <div>
                  <dt>At maturity</dt>
                  <dd>
                    {money(trackedCd.maturityValueCents)}
                    {trackedCd.projectionEstimated && <span className="est"> est.</span>}
                  </dd>
                </div>
              </dl>
              {trackedCd.status === "pending" && (
                <p className="muted small">
                  Waiting on oracle attestation. With <code>offchain/pipeline</code> or
                  the oracle watcher running against this database, this flips to{" "}
                  <strong>active</strong> automatically.
                </p>
              )}
            </div>
          ) : (
            <Spinner label="Refreshing certificate status…" />
          )}
          {trackError && <ErrorNote message={trackError} />}

          <div className="wizactions">
            <button className="button button--quiet" type="button" onClick={() => void refreshTrack()}>
              Refresh status
            </button>
            <a className="button" href={`#/cd/${opened.transactionId}`}>
              Open certificate detail
            </a>
            <a className="button button--quiet" href="#/">
              Dashboard
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
