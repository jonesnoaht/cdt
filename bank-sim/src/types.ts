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
