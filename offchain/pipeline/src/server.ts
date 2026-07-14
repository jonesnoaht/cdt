/**
 * Minimal JSON control server for the issuance service.
 *
 * In emulator mode the chain only exists inside the service process, so the
 * redeem/status CLIs cannot reach it directly; they talk to this endpoint
 * instead (same code paths: the handlers call the same IssuanceService
 * methods the CLIs use in preview mode).
 *
 *   GET  /health           -> { ok, mode, policyId, vaultAddress, ... }
 *   GET  /status           -> StatusRow[]
 *   POST /redeem           -> RedeemOutcome   body: { depositId, early? }
 */
import { createServer, type Server } from "node:http";
import type { IssuanceService } from "./service.js";
import type { ChainContext } from "./provider.js";

/** JSON.stringify with bigints rendered as strings. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
}

export function createControlServer(
  service: IssuanceService,
  chain: ChainContext,
): Server {
  return createServer((req, res) => {
    const respond = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(toJson(body));
    };
    const fail = (err: unknown): void =>
      respond(400, { error: String(err instanceof Error ? err.message : err) });

    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") {
      respond(200, {
        ok: true,
        mode: chain.mode,
        network: chain.network,
        policyId: chain.scripts.policyId,
        vaultAddress: chain.scripts.vaultAddress,
        issuerAddress: chain.issuer.address,
        oracleVkh: chain.oracle.vkh,
        chainTime: chain.now(),
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/status") {
      service.status().then((rows) => respond(200, rows), fail);
      return;
    }
    if (req.method === "POST" && url.pathname === "/redeem") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        try {
          const body = JSON.parse(
            Buffer.concat(chunks).toString("utf8") || "{}",
          ) as { depositId?: string; early?: boolean };
          if (!body.depositId) {
            respond(400, { error: "depositId is required" });
            return;
          }
          service
            .redeem({ depositId: body.depositId, early: body.early ?? false })
            .then((outcome) => respond(200, outcome), fail);
        } catch (err) {
          fail(err);
        }
      });
      return;
    }
    respond(404, { error: "not found" });
  });
}
