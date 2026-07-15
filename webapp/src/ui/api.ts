/** Typed fetch client for the portal API. */
import type {
  AccountDto,
  CdDto,
  ChainLookupDto,
  ClaimLookupDto,
  DepositRequest,
  DepositResponse,
  MemberDto,
  PaymentChallengeDto,
  PaymentOraclePubKeyDto,
  PaymentVerifyRequest,
  PaymentVerifyResponse,
  PresentmentDto,
  PresentmentRequest,
  ProductDto,
  SignedPaymentCheck,
  TokenizePrepDto,
} from "../shared/types.js";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed (${res.status}).`;
    throw new ApiRequestError(message, res.status);
  }
  return body as T;
}

export const api = {
  members: () => request<MemberDto[]>("/api/members"),
  products: () => request<ProductDto[]>("/api/products"),
  accounts: (memberId: number) => request<AccountDto[]>(`/api/members/${memberId}/accounts`),
  tokenizePrep: (memberId: number) =>
    request<TokenizePrepDto>(`/api/members/${memberId}/tokenize-prep`),
  cds: (memberId: number, opts?: { curve?: boolean }) =>
    request<CdDto[]>(`/api/members/${memberId}/cds${opts?.curve ? "?curve=1" : ""}`),
  openCd: (memberId: number, body: DepositRequest) =>
    request<DepositResponse>(`/api/members/${memberId}/deposits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  chain: (depositId: string | number) => request<ChainLookupDto>(`/api/cds/${depositId}/chain`),
  correspondentMeta: () =>
    request<{
      presentingCuName: string;
      issuerName: string;
      role: string;
      description: string;
    }>("/api/correspondent/meta"),
  lookupClaim: (ref: string) => request<ClaimLookupDto>(`/api/claims/${encodeURIComponent(ref)}`),
  presentments: () => request<PresentmentDto[]>("/api/presentments"),
  presentment: (id: number) => request<PresentmentDto>(`/api/presentments/${id}`),
  createPresentment: (body: PresentmentRequest) =>
    request<PresentmentDto>("/api/presentments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  paymentContract: () =>
    request<{
      name: string;
      paradigm: string;
      description: string;
      flow: string[];
      nonGoals: string[];
    }>("/api/payment/contract"),
  paymentOraclePubkey: () => request<PaymentOraclePubKeyDto>("/api/payment/oracle-pubkey"),
  paymentChallenge: () => request<PaymentChallengeDto>("/api/payment/challenge", { method: "POST" }),
  paymentVerify: (body: PaymentVerifyRequest) =>
    request<PaymentVerifyResponse>("/api/payment/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  paymentVerifySignature: (body: SignedPaymentCheck) =>
    request<{ valid: boolean; reason?: string }>("/api/payment/verify-signature", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
};
