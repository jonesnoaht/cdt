import { BRAND_NAME } from "../App.js";

export function About() {
  return (
    <section className="about">
      <h1 className="display">How tokenized certificates work</h1>
      <p className="lede">
        A share certificate you can hold in your own wallet — while your money stays
        safely at the credit union. The bank desk flow mirrors real CIP → core booking →
        oracle attestation → mint.
      </p>

      <ol className="steps">
        <li>
          <h3>CIP / KYC at the credit union</h3>
          <p>
            Membership, Customer Identification Program, and OFAC screening happen off-chain
            in the core system. Only after CIP passes does the credit union issue an{" "}
            <em>AccountHolderCredential</em> (trust chain: NCUA → insured institution →
            member). No valid credential chain, no mint.
          </p>
        </li>
        <li>
          <h3>Book the CD on the core ledger</h3>
          <p>
            Staff (or the portal) choose a term and amount and record a CD-funding deposit
            at {BRAND_NAME}. Dollars never leave the credit union. The deposit is federally
            insured by the NCUA up to applicable limits; the token that follows is a record,
            not an insured asset itself.
          </p>
        </li>
        <li>
          <h3>Oracle attests the deposit</h3>
          <p>
            An automated service verifies the member&apos;s verifiable-credential presentation
            and signs an attestation: this member holds this certificate, at this rate,
            until this date. Only a co-signed attestation authorizes minting.
          </p>
        </li>
        <li>
          <h3>A certificate token is minted</h3>
          <p>
            One CDT native asset is minted on Cardano and locked with terms in a vault
            (principal + interest). The token carries economic terms and key hashes — not
            name, SSN, or account number.
          </p>
        </li>
        <li>
          <h3>Redeem at maturity — or early, with a penalty</h3>
          <p>
            At maturity, burning the token pays principal plus full dividend. Early
            withdrawal pays principal plus accrued dividends less the disclosed penalty.
            The math on chain matches the math in this portal.
          </p>
        </li>
      </ol>

      <h2>Common questions</h2>
      <dl className="faq">
        <dt>Is my money &quot;in crypto&quot;?</dt>
        <dd>
          No. Your deposit never leaves the credit union. The token is a record of
          ownership — like a paper certificate, but one that can be verified
          electronically.
        </dd>
        <dt>What if I lose the token?</dt>
        <dd>
          The credit union keeps its own books. After re-verifying the member credential,
          the institution can invalidate a stranded token and reissue. The insured deposit
          claim lives on the core ledger.
        </dd>
        <dt>Can I trade the token on a DEX?</dt>
        <dd>
          CDT is a freely spendable native asset. Anyone can transfer it; that does not
          automatically move the insured deposit claim. Payment terminals should optionally
          run the <a href="#/pay">payment-oracle verification contract</a> before accepting
          CDT as payment.
        </dd>
        <dt>Can another credit union cash my CDT?</dt>
        <dd>
          A non-issuing CU can verify the claim and may advance cash as a correspondent,
          then settle with the issuer. They do not become the insurer of the original
          deposit. Use the <a href="#/present">Foreign CDT cash-out</a> desk for that
          presentment flow. Free peer-to-peer transfer of the token is out of scope.
        </dd>
        <dt>Why do this at all?</dt>
        <dd>
          A tokenized certificate can be proven and audited without paperwork while keeping
          the deposit insured and the terms locked. It brings the certificate to the
          member, instead of the member to the branch.
        </dd>
      </dl>
    </section>
  );
}
