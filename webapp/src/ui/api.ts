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

/** Credit-claim facility (CD + secured LOC) API shapes. */
export type FacilityDto = {
  id: number;
  certificateId: number;
  borrowerAccountId: number;
  seriesId: string;
  limitCents: number;
  drawnCents: number;
  holdsCents: number;
  availableCents: number;
  rateBps: number;
  ltvBps: number;
  status: string;
  maturityAt: string;
  onChainSupplyCents: number;
};

export type FacilityPresentmentDto = {
  id: number;
  facilityId: number;
  amountCents: number;
  presenterWallet: string;
  status: string;
  burnTxHash: string | null;
};

export const api = {
  members: () => request<MemberDto[]>("/api/members"),
  products: () => request<ProductDto[]>("/api/products"),
  openFacility: (body: {
    accountId: number;
    productId: number;
    principalCents: number;
    depositorWallet: string;
    ltvBps?: number;
    locSpreadBps?: number;
  }) =>
    request<FacilityDto>("/api/facilities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  getFacility: (id: number) => request<FacilityDto>(`/api/facilities/${id}`),
  requestFacilityPresentment: (
    facilityId: number,
    body: {
      amountCents: number;
      presenterWallet: string;
      presenterName?: string;
      cipRef: string;
    },
  ) =>
    request<FacilityPresentmentDto>(`/api/facilities/${facilityId}/presentments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  payFacilityPresentment: (id: number) =>
    request<FacilityPresentmentDto>(`/api/presentments/${id}/pay`, { method: "POST" }),
  burnFacilityPresentment: (id: number, burnTxHash: string) =>
    request<FacilityPresentmentDto>(`/api/presentments/${id}/burn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ burnTxHash }),
    }),
  facilityWaterfall: (id: number) =>
    request<unknown>(`/api/facilities/${id}/waterfall`, { method: "POST" }),
  facilityReissue: (
    id: number,
    body: {
      newTermMonths: number;
      currentOnChainSupplyCents: number;
      newLtvBps?: number;
    },
  ) =>
    request<FacilityDto>(`/api/facilities/${id}/reissue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
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
  authorizePresentment: (id: number) =>
    request<PresentmentDto>(`/api/presentments/${id}/authorize`, { method: "POST" }),
  submitBurnEvidence: (id: number, body: { txHash: string; mode?: string }) =>
    request<PresentmentDto>(`/api/presentments/${id}/burn-evidence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  acceptBurn: (id: number) =>
    request<PresentmentDto>(`/api/presentments/${id}/accept-burn`, { method: "POST" }),
  settlementPayment: (
    id: number,
    body: { amountCents: number; rail?: string; traceId?: string },
  ) =>
    request<PresentmentDto>(`/api/presentments/${id}/settlement-payment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  settlementPubkey: () =>
    request<{
      algorithm: string;
      publicKeySpkiBase64: string;
      purpose: string;
      issuerInstitutionId: string;
    }>("/api/settlement/pubkey"),
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
  createSignRequest: (body: {
    purpose: string;
    cborHex: string;
    depositId?: string;
    presentmentId?: number;
    description?: string;
    publicBaseUrl: string;
    deepLinkTemplate?: string;
    walletBrand?: string;
  }) =>
    request<unknown>("/api/sign-requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  getSignRequest: (id: string) => request<unknown>(`/api/sign-requests/${encodeURIComponent(id)}`),
  completeSignRequest: (
    id: string,
    body: { signedCborHex?: string; witnessCborHex?: string },
  ) =>
    request<unknown>(`/api/sign-requests/${encodeURIComponent(id)}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
};
