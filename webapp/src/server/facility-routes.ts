/**
 * Credit-claim facility HTTP routes (core-led CD + secured LOC).
 * Domain logic lives in bank-sim; this module is a thin Hono adapter.
 */
import { Hono } from "hono";
import type pg from "pg";
import {
  drawAndPayPresentment,
  getFacility,
  markPresentmentBurned,
  openFacility,
  reissueFacility,
  requestPresentment,
  runMaturityWaterfall,
} from "../../../bank-sim/src/facility.js";

function errorStatus(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err);
  if (/not found/i.test(msg)) return 404;
  if (
    /must be|required|exceeds|cannot reissue|not presentable|positive integer|cd_product|CIP/i.test(
      msg,
    )
  ) {
    return 400;
  }
  return 500;
}

export function facilityRoutes(pool: pg.Pool): Hono {
  const r = new Hono();

  r.post("/facilities", async (c) => {
    try {
      const body = await c.req.json();
      const facility = await openFacility(pool, {
        accountId: Number(body.accountId),
        productId: Number(body.productId),
        principalCents: Number(body.principalCents),
        depositorWallet: String(body.depositorWallet ?? ""),
        ltvBps: body.ltvBps != null ? Number(body.ltvBps) : undefined,
        locSpreadBps:
          body.locSpreadBps != null ? Number(body.locSpreadBps) : undefined,
      });
      return c.json(facility);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        errorStatus(err) as 400,
      );
    }
  });

  r.get("/facilities/:id", async (c) => {
    try {
      const facility = await getFacility(pool, Number(c.req.param("id")));
      return c.json(facility);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        errorStatus(err) as 404,
      );
    }
  });

  r.post("/facilities/:id/presentments", async (c) => {
    try {
      const body = await c.req.json();
      const p = await requestPresentment(pool, {
        facilityId: Number(c.req.param("id")),
        amountCents: Number(body.amountCents),
        presenterWallet: String(body.presenterWallet ?? ""),
        presenterName: body.presenterName != null ? String(body.presenterName) : undefined,
        cipRef: String(body.cipRef ?? ""),
      });
      return c.json(p);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        errorStatus(err) as 400,
      );
    }
  });

  r.post("/presentments/:id/pay", async (c) => {
    try {
      const p = await drawAndPayPresentment(pool, Number(c.req.param("id")));
      return c.json(p);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        errorStatus(err) as 400,
      );
    }
  });

  r.post("/presentments/:id/burn", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const burnTxHash = String(
        (body as { burnTxHash?: string }).burnTxHash ?? "",
      );
      if (!burnTxHash) {
        return c.json({ error: "burnTxHash required" }, 400);
      }
      const p = await markPresentmentBurned(
        pool,
        Number(c.req.param("id")),
        burnTxHash,
      );
      return c.json(p);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        errorStatus(err) as 400,
      );
    }
  });

  r.post("/facilities/:id/waterfall", async (c) => {
    try {
      const result = await runMaturityWaterfall(
        pool,
        Number(c.req.param("id")),
      );
      return c.json(result);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        errorStatus(err) as 400,
      );
    }
  });

  r.post("/facilities/:id/reissue", async (c) => {
    try {
      const body = await c.req.json();
      const facility = await reissueFacility(pool, {
        facilityId: Number(c.req.param("id")),
        newTermMonths: Number(body.newTermMonths),
        currentOnChainSupplyCents: Number(body.currentOnChainSupplyCents),
        newLtvBps: body.newLtvBps != null ? Number(body.newLtvBps) : undefined,
        newLocSpreadBps:
          body.newLocSpreadBps != null
            ? Number(body.newLocSpreadBps)
            : undefined,
      });
      return c.json(facility);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        errorStatus(err) as 400,
      );
    }
  });

  return r;
}
