export { canonicalize } from './canonicalize.js';
export {
  generateEd25519KeyPair,
  privateKeyFromPem,
  privateKeyToPem,
  publicKeyFromBase64,
  publicKeyToBase64,
  signUtf8,
  verifyUtf8,
  type Ed25519KeyPair,
} from './keys.js';
export {
  buildAttestationPayload,
  centsToLovelace,
  signAttestation,
  verifyAttestation,
  LOVELACE_PER_CENT,
  MS_PER_MONTH,
  type AttestationInputs,
  type AttestationPayload,
  type SignedAttestation,
} from './attestation.js';
export {
  OracleWatcher,
  type OracleWatcherOptions,
  type OnAttestedHook,
  type PendingDeposit,
  type VerifyPresentationHook,
  type VerifyPresentationResult,
  type WatcherLogger,
} from './watcher.js';
export { loadConfig, createPool, type OracleWatcherConfig, type PgConfig } from './config.js';
export {
  createIdentity,
  createPresentation,
  issueCredential,
  verifyPresentation,
  VC_CONTEXT,
  type MockCredential,
  type MockIdentity,
  type MockPresentation,
  type MockProof,
  type VerifyResult,
} from './vc-mock.js';
