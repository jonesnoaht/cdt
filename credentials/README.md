# @cdt/credentials

Mock W3C Verifiable Credentials 1.1 package for the Certificate of Deposit
Token (CDT). It implements the credential trust chain that gates CDT
issuance:

```
NCUA (trusted root)
  └─ InsuredInstitutionCredential ──► CampusUSA Credit Union
                                        └─ AccountHolderCredential ──► member (holder)
```

A verifier (e.g. the CDT minting service) hands the member a fresh challenge,
the member responds with a signed `VerifiablePresentation` wrapping both
credentials, and `verifyPresentation` checks every signature, the chain back
to the NCUA root, expiry, holder binding, and the challenge.

This is a **self-contained mock**: zero runtime dependencies, Ed25519 via
`node:crypto`, and a vendored base58btc codec. In production it would be
replaced by [Hyperledger Identus](https://github.com/hyperledger-identus)
(the successor of Atala PRISM, which the 2021 CDT proposal targeted) — see
[Swapping in Identus](#swapping-in-identus).

## Requirements

- Node.js >= 22
- npm

## Usage

```bash
npm ci
npm test        # vitest suite
npm run example # prints a full ceremony: issue -> present -> verify
```

```ts
import {
  createIssuer,
  createHolder,
  issueCredential,
  createPresentation,
  verifyPresentation,
  INSURED_INSTITUTION_CREDENTIAL,
  ACCOUNT_HOLDER_CREDENTIAL,
} from "@cdt/credentials";

// Actors: each has an Ed25519 keypair and a did:key DID.
const ncua = createIssuer("NCUA");
const campusUsa = createIssuer("CampusUSA Credit Union");
const member = createHolder();

// NCUA attests that CampusUSA is federally insured.
const institutionCredential = issueCredential(
  ncua,
  campusUsa.did,
  INSURED_INSTITUTION_CREDENTIAL,
  { charterNumber: "68589", insuranceFund: "NCUSIF" },
  { expiresInMs: 365 * 24 * 60 * 60 * 1000 },
);

// CampusUSA attests the member's identity/KYC.
const memberCredential = issueCredential(
  campusUsa,
  member.did,
  ACCOUNT_HOLDER_CREDENTIAL,
  { name: "Alex Gator", memberSince: "2019-08-01", accountStanding: "good" },
  { expiresInMs: 365 * 24 * 60 * 60 * 1000 },
);

// Verifier supplies a fresh nonce; member presents both credentials.
const challenge = crypto.randomUUID();
const presentation = createPresentation(
  member,
  [institutionCredential, memberCredential],
  { challenge },
);

// Verifier checks the whole chain back to the NCUA root.
const result = verifyPresentation(presentation, {
  trustedRoots: [ncua.did],
  challenge,
});
// -> { ok: true } or { ok: false, reason: "..." }
```

## API

### Actors

- `createIssuer(name: string): Issuer` — fresh Ed25519 keypair + `did:key`
  DID plus a display name. Used for the NCUA and the credit union.
- `createHolder(): Holder` — fresh Ed25519 keypair + `did:key` DID. Used for
  the member.

### `issueCredential(issuer, subjectDid, type, claims, options?)`

Returns a `VerifiableCredential` (W3C VC Data Model 1.1 plain JSON):
`@context`, `type: ["VerifiableCredential", type]`, `issuer` (DID),
`issuanceDate`, optional `expirationDate` (from `options.expiresInMs`),
`credentialSubject: { id: subjectDid, ...claims }`, and a proof (below).

### `createPresentation(holder, credentials, { challenge })`

Wraps credentials in a `VerifiablePresentation` signed by the holder. The
verifier-supplied `challenge` is embedded in the proof and covered by the
signature, preventing replay of an old presentation against a new challenge.

### `verifyPresentation(presentation, { trustedRoots, challenge, now? })`

Returns `{ ok: true }` or `{ ok: false, reason }`. Checks, in order:

1. **Presentation proof** — signed by the stated `holder`
   (`proof.verificationMethod === holder`), signature valid,
   `proofPurpose` is `authentication`, and `proof.challenge` equals the
   expected `challenge` (which must be a non-empty string — omitting it at
   runtime is rejected rather than silently matching a challenge-less proof).
2. **Every credential** — proof signed by its stated `issuer`, signature
   valid (any tampering with claims breaks it), `proofPurpose` is
   `assertionMethod`, `issuanceDate` not in the future, `expirationDate`
   (if present) not passed.
3. **Trust chain** — every credential's issuer is either in `trustedRoots`
   or is the subject of a valid `InsuredInstitutionCredential` issued by a
   trusted root *within the same presentation*. A self-issued member
   credential therefore fails.
4. **Holder binding** — every credential's subject is the presentation
   holder, except chain credentials (`InsuredInstitutionCredential`s whose
   subject is *another* credential's issuer — a self-referential attestation
   does not count), and at least one credential must be about the holder.
   A presentation signed by anyone other than the credential subject
   therefore fails.

### Lower-level exports

- `didFromPublicKey`, `publicKeyFromDid`, `didToRawPublicKey`,
  `rawPublicKeyBytes`, `generateKeyPair`, `signMessage`, `verifyMessage`
- `canonicalize` — deterministic JSON stringify (recursively sorted keys)
- `base58btcEncode`, `base58btcDecode` — vendored base58btc codec

## Design notes

- **DIDs** are `did:key` style: `did:key:z` + base58btc(multicodec
  `ed25519-pub` prefix `0xed 0x01` + raw 32-byte public key).
- **Proofs** are mock `Ed25519Signature2020`-style. The signing payload is
  the canonicalized document *minus* `proof`, combined with the proof options
  *minus* `proofValue` (so `verificationMethod` and `challenge` are covered
  by the signature). The Ed25519 signature is base58btc-encoded in
  `proofValue`.
- **Canonicalization** is a deterministic JSON stringify with recursively
  sorted keys — a stand-in for the RDF/JCS canonicalization a real proof
  suite requires. Key-order-permuted copies of a document verify identically,
  and documents verify identically before and after a JSON round-trip
  (`toJSON` is honored, e.g. for `Date` claims; other non-plain objects are
  rejected so distinct documents can never share a signature).
- **Building**: `npm ci` runs the `prepare` script, which compiles `dist/`
  so the `exports` entry point works for consumers immediately after install.

## Swapping in Identus

The mock keeps the same conceptual shapes as Hyperledger Identus (Atala
PRISM's successor), so the swap is mostly substitution at the edges:

| This package | Identus |
| --- | --- |
| `createIssuer` / `createHolder` (`did:key`) | Cloud Agent DID registrar (`did:prism`, published on Cardano) |
| `issueCredential` | Issue flow over DIDComm/OIDC4VCI (Cloud Agent `/issue-credentials`) |
| `createPresentation({ challenge })` | Present-proof flow; the challenge maps to the proof-request nonce |
| `verifyPresentation({ trustedRoots })` | Verification policies + trust registry of root issuer DIDs |
| Deterministic-JSON `Ed25519Signature2020` mock proof | Real proof suites (JWT-VC / Ed25519Signature2020 / AnonCreds) with RDF/JCS canonicalization |
| No revocation | Credential status lists (revocation) anchored via the VDR |

Consumers should depend only on the exported API surface (`createIssuer`,
`createHolder`, `issueCredential`, `createPresentation`,
`verifyPresentation`, and the `VerifiableCredential` /
`VerifiablePresentation` JSON shapes); an Identus-backed implementation can
then be dropped in behind the same functions.
