/** Typed fetch client for the portal API. */
import type {
  AccountDto,
  CdDto,
  ChainLookupDto,
  DepositRequest,
  DepositResponse,
  MemberDto,
  ProductDto,
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
  cds: (memberId: number, opts?: { curve?: boolean }) =>
    request<CdDto[]>(`/api/members/${memberId}/cds${opts?.curve ? "?curve=1" : ""}`),
  openCd: (memberId: number, body: DepositRequest) =>
    request<DepositResponse>(`/api/members/${memberId}/deposits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  chain: (depositId: string | number) => request<ChainLookupDto>(`/api/cds/${depositId}/chain`),
};
