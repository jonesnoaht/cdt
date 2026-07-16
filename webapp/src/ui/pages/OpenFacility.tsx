/**
 * Open a credit-claim facility: book CD + secured LOC, mint CDT = available credit.
 * Coupon stays with the depositor; CDT is bearer claim on their line.
 */
import { useEffect, useState, type FormEvent } from "react";
import type { AccountDto, MemberDto, ProductDto } from "../../shared/types.js";
import { ApiRequestError, api, type FacilityDto } from "../api.js";
import { ErrorNote, Spinner } from "../components.js";
import { money } from "../format.js";

export function OpenFacility({ member }: { member: MemberDto }) {
  const [products, setProducts] = useState<ProductDto[] | null>(null);
  const [accounts, setAccounts] = useState<AccountDto[] | null>(null);
  const [productId, setProductId] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [amountText, setAmountText] = useState("10000");
  const [wallet, setWallet] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facility, setFacility] = useState<FacilityDto | null>(null);

  useEffect(() => {
    Promise.all([api.products(), api.accounts(member.id)])
      .then(([p, a]) => {
        setProducts(p);
        setAccounts(a);
        const funding = a.find((x) => x.kind === "cd_funding");
        if (funding) {
          setAccountId(funding.id);
          setWallet(funding.walletAddress || "");
        }
        if (p[0]) setProductId(p[0].id);
      })
      .catch((e) => setError(String(e)));
  }, [member.id]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!ack) {
      setError("You must acknowledge that CDT lets others draw your secured line.");
      return;
    }
    if (productId == null || accountId == null) {
      setError("Select product and account.");
      return;
    }
    const dollars = Number(amountText);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError("Enter a positive principal amount.");
      return;
    }
    const principalCents = Math.round(dollars * 100);
    setBusy(true);
    try {
      const f = await api.openFacility({
        accountId,
        productId,
        principalCents,
        depositorWallet: wallet || "addr_demo_depositor",
        ltvBps: 9000,
        locSpreadBps: 250,
      });
      setFacility(f);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (products === null || accounts === null) return <Spinner />;

  return (
    <section className="panel">
      <h1>Open credit-claim facility</h1>
      <p className="lede">
        You keep the certificate coupon on the full pledged principal. CDT minted to your wallet
        equals available secured credit. <strong>Anyone who holds CDT may cash out and draw your
        line</strong> — they are not the borrower; you are.
      </p>

      {facility ? (
        <div className="note note--ok">
          <h2>Facility open</h2>
          <ul>
            <li>Facility id: {facility.id}</li>
            <li>Series: <code>{facility.seriesId}</code></li>
            <li>Limit (CDT minted): {money(facility.limitCents)}</li>
            <li>LOC available: {money(facility.availableCents)}</li>
            <li>Status: {facility.status}</li>
          </ul>
          <p>
            <a href={`#/facility-present?id=${facility.id}`}>Present / cash-out CDT against this facility →</a>
          </p>
          <p>
            <a href={`#/facility-ops?id=${facility.id}`}>Issuer ops (waterfall / reissue) →</a>
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="form-stack">
          {error && <ErrorNote message={error} />}
          <label>
            CD funding account
            <select
              value={accountId ?? ""}
              onChange={(e) => setAccountId(Number(e.target.value))}
            >
              {accounts
                .filter((a) => a.kind === "cd_funding")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    #{a.id} · {a.kind}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Certificate product
            <select
              value={productId ?? ""}
              onChange={(e) => setProductId(Number(e.target.value))}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.rateBps} bps
                </option>
              ))}
            </select>
          </label>
          <label>
            Principal (USD)
            <input
              type="number"
              min="1"
              step="0.01"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
            />
          </label>
          <label>
            Depositor wallet (CDT destination)
            <input
              type="text"
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
              placeholder="addr…"
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            I understand CDT is not NCUSIF-insured, I remain the sole borrower on the LOC, and
            holders may present CDT to draw my line while I keep the CD coupon.
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "Opening…" : "Open facility (mint CDT = 90% LTV)"}
          </button>
        </form>
      )}
    </section>
  );
}
