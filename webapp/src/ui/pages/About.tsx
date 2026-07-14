import { BRAND_NAME } from "../App.js";

export function About() {
  return (
    <section className="about">
      <h1 className="display">How tokenized certificates work</h1>
      <p className="lede">
        A share certificate you can hold in your own wallet — while your money stays
        safely at the credit union.
      </p>

      <ol className="steps">
        <li>
          <h3>You open a certificate</h3>
          <p>
            Exactly like today: choose a term, choose an amount, and your deposit moves
            into a certificate funding account at {BRAND_NAME}. Your money is held at the
            credit union and federally insured by the NCUA, the same as any other share
            certificate.
          </p>
        </li>
        <li>
          <h3>The credit union attests your deposit</h3>
          <p>
            An automated service at the credit union verifies your membership and signs a
            statement — an <em>attestation</em> — that says "this member holds this
            certificate, at this rate, until this date." Only the credit union can sign
            it.
          </p>
        </li>
        <li>
          <h3>A certificate token is minted</h3>
          <p>
            The signed attestation authorizes minting a single token on the Cardano
            network, delivered to your wallet. The token is your certificate's ownership
            record: it carries the principal, rate, start and maturity date — nothing
            else. It is not a cryptocurrency investment, and its terms never change.
          </p>
        </li>
        <li>
          <h3>Redeem at maturity — or early, with a penalty</h3>
          <p>
            At maturity, presenting the token pays out your principal plus the full
            dividend. Withdrawing early pays principal plus dividends accrued so far,
            less the early-withdrawal penalty stated when you opened the certificate.
            The math enforced on chain is the same math shown in this portal.
          </p>
        </li>
      </ol>

      <h2>Common questions</h2>
      <dl className="faq">
        <dt>Is my money "in crypto"?</dt>
        <dd>
          No. Your deposit never leaves the credit union. The token is a record of
          ownership — like a paper certificate, but one that can be verified and
          transferred electronically.
        </dd>
        <dt>What if I lose the token?</dt>
        <dd>
          The credit union keeps its own books, exactly as it does today. In this
          demonstration, the banking record is authoritative and the token mirrors it.
        </dd>
        <dt>Why do this at all?</dt>
        <dd>
          A tokenized certificate can be proven, audited, and (in the future) pledged or
          transferred without paperwork, while keeping the deposit insured and the terms
          locked. It brings the certificate to the member, instead of the member to the
          branch.
        </dd>
      </dl>
    </section>
  );
}
