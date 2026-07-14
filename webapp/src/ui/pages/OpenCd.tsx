import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { DepositResponse, MemberDto, ProductDto } from "../../shared/types.js";
import { ApiRequestError, api } from "../api.js";
import { ErrorNote, Spinner } from "../components.js";
import { money, percentFromBps, termLabel } from "../format.js";

export function OpenCd({ member }: { member: MemberDto }) {
  const [products, setProducts] = useState<ProductDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [productId, setProductId] = useState<number | null>(null);
  const [amountText, setAmountText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [opened, setOpened] = useState<DepositResponse | null>(null);

  useEffect(() => {
    api
      .products()
      .then(setProducts)
      .catch((err) => setLoadError(String(err)));
  }, []);

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
        ? "Enter a dollar amount, like 1500 or 1500.00."
        : product && amountCents < product.minDepositCents
          ? `The minimum for this certificate is ${money(product.minDepositCents)}.`
          : null;

  const ready = product !== null && amountCents !== null && amountProblem === null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || !product || amountCents === null) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api.openCd(member.id, { productId: product.id, amountCents });
      setOpened(res);
    } catch (err) {
      setSubmitError(err instanceof ApiRequestError ? err.message : String(err));
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) return <ErrorNote message={loadError} />;
  if (products === null) return <Spinner label="Loading certificate rates…" />;

  if (opened) {
    return (
      <section className="openflow">
        <h1 className="display">Certificate opened</h1>
        <div className="note note--ok">
          <p>
            <strong>{money(opened.amountCents)}</strong> has been moved from your funding
            account into {product?.name ?? "your new certificate"}. It appears as{" "}
            <em>pending</em> until the credit union attests the deposit — then its
            certificate token is minted on chain automatically.
          </p>
        </div>
        <p>
          <a className="button" href={`#/cd/${opened.transactionId}`}>
            View your certificate
          </a>{" "}
          <a className="button button--quiet" href="#/">
            Back to dashboard
          </a>
        </p>
      </section>
    );
  }

  return (
    <section className="openflow">
      <h1 className="display">Open a share certificate</h1>
      <p className="lede">
        Lock in a guaranteed dividend rate for a fixed term. Your deposit stays at the
        credit union, federally insured.
      </p>

      <form onSubmit={submit}>
        <h3 className="step">1 · Choose a term</h3>
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
                onChange={() => {
                  setProductId(p.id);
                  setConfirming(false);
                }}
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

        <h3 className="step">2 · Deposit amount</h3>
        <div className="amount">
          <span className="amount__symbol" aria-hidden="true">
            $
          </span>
          <input
            inputMode="decimal"
            placeholder={product ? (product.minDepositCents / 100).toFixed(2) : "0.00"}
            value={amountText}
            onChange={(e) => {
              setAmountText(e.currentTarget.value);
              setConfirming(false);
            }}
            aria-label="Deposit amount in dollars"
          />
        </div>
        {amountProblem && <p className="fieldError">{amountProblem}</p>}
        {product && !amountProblem && (
          <p className="muted small">
            Minimum {money(product.minDepositCents)}. Funds come from your CD funding
            account.
          </p>
        )}

        <h3 className="step">3 · Review and confirm</h3>
        {confirming && ready && product && amountCents !== null && (
          <div className="note">
            Open a <strong>{product.name}</strong> with{" "}
            <strong>{money(amountCents)}</strong> at {percentFromBps(product.rateBps)} APY for{" "}
            {termLabel(product.termMonths)}? Early withdrawals forfeit{" "}
            {percentFromBps(product.penaltyBps)} of accrued dividends.
          </div>
        )}
        {submitError && <ErrorNote message={submitError} />}
        <button className="button" type="submit" disabled={!ready || submitting}>
          {submitting
            ? "Opening…"
            : confirming
              ? "Confirm — open certificate"
              : "Review and confirm"}
        </button>
      </form>
    </section>
  );
}
