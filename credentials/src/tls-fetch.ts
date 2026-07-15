/**
 * Optional mTLS / custom CA for outbound institutional HTTP clients.
 * Pure node:https — no extra dependencies.
 *
 * Env:
 *   CDT_TLS_CERT_FILE / CDT_TLS_KEY_FILE  — client certificate (mTLS)
 *   CDT_TLS_CA_FILE                        — custom CA bundle
 *   CDT_TLS_REJECT_UNAUTHORIZED=0          — lab only
 */
import { readFileSync, existsSync } from "node:fs";
import * as https from "node:https";
import { URL } from "node:url";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface TlsFetchOptions {
  certFile?: string;
  keyFile?: string;
  caFile?: string;
  /** Default true. Set false only for lab self-signed without CA pin. */
  rejectUnauthorized?: boolean;
}

function readOptional(path: string | undefined): Buffer | undefined {
  if (!path) return undefined;
  if (!existsSync(path)) throw new Error(`TLS file not found: ${path}`);
  return readFileSync(path);
}

export function createTlsFetch(opts: TlsFetchOptions = {}): FetchLike {
  const cert = readOptional(opts.certFile);
  const key = readOptional(opts.keyFile);
  const ca = readOptional(opts.caFile);
  const rejectUnauthorized = opts.rejectUnauthorized !== false;

  if (!cert && !key && !ca && rejectUnauthorized) {
    return (input, init) => globalThis.fetch(input, init);
  }
  if ((cert && !key) || (!cert && key)) {
    throw new Error("mTLS requires both cert and key files");
  }

  const agentOpts: https.AgentOptions = {
    rejectUnauthorized,
  };
  if (cert && key) {
    agentOpts.cert = cert;
    agentOpts.key = key;
  }
  if (ca) agentOpts.ca = ca;
  const agent = new https.Agent(agentOpts);

  return async (input, init) => {
    const url =
      typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);
    if (url.protocol !== "https:") {
      return globalThis.fetch(input, init);
    }
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((v, k) => {
        headers[k] = v;
      });
    }
    let body: string | Buffer | undefined;
    if (init?.body !== undefined && init.body !== null) {
      body =
        typeof init.body === "string"
          ? init.body
          : Buffer.from(await new Response(init.body).arrayBuffer());
    }

    return new Promise((resolve, reject) => {
      const req = https.request(
        url,
        { method, headers, agent },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c as Buffer));
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            const rh = new Headers();
            for (const [k, v] of Object.entries(res.headers)) {
              if (v === undefined) continue;
              rh.set(k, Array.isArray(v) ? v.join(", ") : String(v));
            }
            resolve(
              new Response(buf, {
                status: res.statusCode ?? 0,
                statusText: res.statusMessage ?? "",
                headers: rh,
              }),
            );
          });
        },
      );
      req.on("error", reject);
      if (init?.signal) {
        const onAbort = () => req.destroy(new Error("aborted"));
        if (init.signal.aborted) onAbort();
        else init.signal.addEventListener("abort", onAbort, { once: true });
      }
      if (body !== undefined) req.write(body);
      req.end();
    });
  };
}

export function tlsFetchFromEnv(env: NodeJS.ProcessEnv = process.env): FetchLike {
  const opts: TlsFetchOptions = {
    rejectUnauthorized: !(
      env.CDT_TLS_REJECT_UNAUTHORIZED === "0" ||
      env.CDT_TLS_REJECT_UNAUTHORIZED === "false"
    ),
  };
  if (env.CDT_TLS_CERT_FILE) opts.certFile = env.CDT_TLS_CERT_FILE;
  if (env.CDT_TLS_KEY_FILE) opts.keyFile = env.CDT_TLS_KEY_FILE;
  if (env.CDT_TLS_CA_FILE) opts.caFile = env.CDT_TLS_CA_FILE;
  return createTlsFetch(opts);
}
