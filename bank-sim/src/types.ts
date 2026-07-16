export type AccountKind = "checking" | "cd_funding";
export type TransactionKind = "deposit" | "withdrawal";

export interface Account {
  id: number;
  memberName: string;
  walletAddress: string;
  did: string;
  kind: AccountKind;
  createdAt: Date;
}

export interface NewAccount {
  memberName: string;
  walletAddress: string;
  did: string;
  kind: AccountKind;
}

export interface BankTransaction {
  id: number;
  accountId: number;
  amountCents: number;
  kind: TransactionKind;
  productId: number | null;
  memo: string | null;
  attested: boolean;
  createdAt: Date;
}

export interface DepositInput {
  accountId: number;
  amountCents: number;
  /** CD product being funded; only valid on cd_funding accounts. */
  productId?: number;
  memo?: string;
}

export interface CdProduct {
  id: number;
  name: string;
  termMonths: number;
  rateBps: number;
  penaltyBps: number;
  minDepositCents: number;
}

/** A cd_funding deposit awaiting oracle attestation, joined with account and product. */
export interface UnattestedCdDeposit {
  transactionId: number;
  amountCents: number;
  memo: string | null;
  createdAt: Date;
  account: {
    id: number;
    memberName: string;
    walletAddress: string;
    did: string;
  };
  product: CdProduct;
}

export interface Attestation {
  id: number;
  transactionId: number;
  depositId: string;
  payload: unknown;
  signedAt: Date;
}

export interface Balances {
  accountId: number;
  depositsCents: number;
  withdrawalsCents: number;
  balanceCents: number;
}

// --- Credit-claim facility (CD + secured LOC) ---

export type CertificateStatus = "open" | "pledged" | "matured" | "closed";
export type FacilityStatus =
  | "pending"
  | "active"
  | "maturing"
  | "default"
  | "closed";
export type FacilityPresentmentStatus =
  | "requested"
  | "drawn"
  | "paid"
  | "burned"
  | "failed"
  | "reconciled";

export interface Certificate {
  id: number;
  accountId: number;
  productId: number;
  principalCents: number;
  rateBps: number;
  startAt: Date;
  maturityAt: Date;
  status: CertificateStatus;
  createdAt: Date;
}

export interface CreditFacility {
  id: number;
  certificateId: number;
  borrowerAccountId: number;
  seriesId: string;
  limitCents: number;
  drawnCents: number;
  holdsCents: number;
  /** limit - drawn - holds */
  availableCents: number;
  rateBps: number;
  ltvBps: number;
  status: FacilityStatus;
  maturityAt: Date;
  /** Mirror of CDT supply for reconcile (core view). */
  onChainSupplyCents: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpenFacilityInput {
  accountId: number;
  productId: number;
  principalCents: number;
  /** Default 9000 = 90%. */
  ltvBps?: number;
  /** LOC spread over CD rate; default 250. */
  locSpreadBps?: number;
  /** Depositor wallet that will receive minted CDT. */
  depositorWallet: string;
  /** Optional fixed clock for tests. */
  now?: Date;
}

export interface FacilityPresentment {
  id: number;
  facilityId: number;
  amountCents: number;
  presenterWallet: string;
  presenterName: string;
  cipRef: string;
  status: FacilityPresentmentStatus;
  burnTxHash: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RequestPresentmentInput {
  facilityId: number;
  amountCents: number;
  presenterWallet: string;
  presenterName?: string;
  /** Demo CIP stub: non-empty means pass. */
  cipRef: string;
}

export interface WaterfallResult {
  facility: CreditFacility;
  repaidLocCents: number;
  paidCdtHoldersCents: number;
  residualToDepositorCents: number;
  proRata: boolean;
}

export interface ReissueInput {
  facilityId: number;
  newTermMonths: number;
  newLtvBps?: number;
  newLocSpreadBps?: number;
  /** Must reflect current on-chain supply; reject if > new limit. */
  currentOnChainSupplyCents: number;
  now?: Date;
}
