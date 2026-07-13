/**
 * Minimal in-memory core-banking ledger, vendored for the demo.
 *
 * Models just enough of a credit union's books to tell the CDT story:
 * member share accounts, CD products, and CD deposits that move money from a
 * member's share account into the credit union's CD funding account.
 *
 * No Postgres, no docker — everything lives in Maps.
 */

export interface Account {
  id: string;
  ownerName: string;
  /** Balance in US cents. */
  balanceCents: bigint;
}

export interface CdProduct {
  id: string;
  name: string;
  termMonths: number;
  /** Annual rate in basis points. */
  rateBps: number;
  /** Early-withdrawal penalty on accrued interest, in basis points. */
  penaltyBps: number;
}

export type DepositStatus = "funded" | "tokenized" | "closed";

export interface CdDeposit {
  id: string;
  accountId: string;
  productId: string;
  amountCents: bigint;
  status: DepositStatus;
  /** Hex-encoded on-chain deposit id (CDT asset name), set when tokenized. */
  onchainDepositId?: string;
}

export class BankLedger {
  private accounts = new Map<string, Account>();
  private products = new Map<string, CdProduct>();
  private deposits = new Map<string, CdDeposit>();

  /** The credit union's own account that holds funded CD principal. */
  readonly cdFundingAccountId = "acct-cd-funding";

  constructor(creditUnionName: string) {
    this.openAccount(this.cdFundingAccountId, `${creditUnionName} CD funding`, 0n);
  }

  openAccount(id: string, ownerName: string, openingBalanceCents: bigint): Account {
    if (this.accounts.has(id)) throw new Error(`account exists: ${id}`);
    if (openingBalanceCents < 0n) throw new Error("negative opening balance");
    const account: Account = { id, ownerName, balanceCents: openingBalanceCents };
    this.accounts.set(id, account);
    return account;
  }

  getAccount(id: string): Account {
    const account = this.accounts.get(id);
    if (!account) throw new Error(`no such account: ${id}`);
    return account;
  }

  addProduct(product: CdProduct): CdProduct {
    if (this.products.has(product.id)) {
      throw new Error(`product exists: ${product.id}`);
    }
    const stored = { ...product };
    this.products.set(stored.id, stored);
    return stored;
  }

  getProduct(id: string): CdProduct {
    const product = this.products.get(id);
    if (!product) throw new Error(`no such product: ${id}`);
    return product;
  }

  credit(accountId: string, amountCents: bigint): Account {
    if (amountCents <= 0n) throw new Error("credit must be positive");
    const account = this.getAccount(accountId);
    account.balanceCents += amountCents;
    return account;
  }

  debit(accountId: string, amountCents: bigint): Account {
    if (amountCents <= 0n) throw new Error("debit must be positive");
    const account = this.getAccount(accountId);
    if (account.balanceCents < amountCents) {
      throw new Error(`insufficient funds in ${accountId}`);
    }
    account.balanceCents -= amountCents;
    return account;
  }

  /**
   * Member funds a CD: money moves from their share account into the credit
   * union's CD funding account, and a deposit record is opened.
   */
  fundCdDeposit(
    depositId: string,
    accountId: string,
    productId: string,
    amountCents: bigint,
  ): CdDeposit {
    if (this.deposits.has(depositId)) {
      throw new Error(`deposit exists: ${depositId}`);
    }
    this.getProduct(productId);
    this.debit(accountId, amountCents);
    this.credit(this.cdFundingAccountId, amountCents);
    const deposit: CdDeposit = {
      id: depositId,
      accountId,
      productId,
      amountCents,
      status: "funded",
    };
    this.deposits.set(depositId, deposit);
    return deposit;
  }

  getDeposit(id: string): CdDeposit {
    const deposit = this.deposits.get(id);
    if (!deposit) throw new Error(`no such deposit: ${id}`);
    return deposit;
  }

  /** Oracle confirms the fiat leg and records the on-chain identifier. */
  markTokenized(depositId: string, onchainDepositId: string): CdDeposit {
    const deposit = this.getDeposit(depositId);
    if (deposit.status !== "funded") {
      throw new Error(`deposit ${depositId} is ${deposit.status}, not funded`);
    }
    deposit.status = "tokenized";
    deposit.onchainDepositId = onchainDepositId;
    return deposit;
  }

  /** CD closed (redeemed or withdrawn on-chain); fiat books are settled. */
  closeDeposit(depositId: string): CdDeposit {
    const deposit = this.getDeposit(depositId);
    if (deposit.status !== "tokenized") {
      throw new Error(`deposit ${depositId} is ${deposit.status}, not tokenized`);
    }
    this.debit(this.cdFundingAccountId, deposit.amountCents);
    deposit.status = "closed";
    return deposit;
  }
}
