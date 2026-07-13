export { base58btcDecode, base58btcEncode } from "./base58.js";
export { canonicalize } from "./canonicalize.js";
export {
  didFromPublicKey,
  didToRawPublicKey,
  generateKeyPair,
  publicKeyFromDid,
  rawPublicKeyBytes,
  signMessage,
  verifyMessage,
  type KeyPair,
} from "./did.js";
export {
  ACCOUNT_HOLDER_CREDENTIAL,
  INSURED_INSTITUTION_CREDENTIAL,
  PROOF_TYPE,
  VC_CONTEXT,
  createHolder,
  createIssuer,
  createPresentation,
  issueCredential,
  verifyPresentation,
  type CredentialSubject,
  type Holder,
  type IssueOptions,
  type Issuer,
  type PresentationOptions,
  type Proof,
  type VerifiableCredential,
  type VerifiablePresentation,
  type VerifyOptions,
  type VerifyResult,
} from "./vc.js";
