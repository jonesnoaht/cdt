/**
 * JWT unit tests + credentialGrantsRole JWT path.
 */
import { describe, expect, it } from "vitest";
import { signJwt, verifyJwt } from "../src/server/jwt.js";
import { credentialGrantsRole } from "../src/server/security.js";

const secret = "test-jwt-secret-at-least-16-chars";

describe("jwt HS256", () => {
  it("signs and verifies", () => {
    const token = signJwt({ role: "issuer", sub: "cu_campususa", ttlSec: 60 }, secret, 1_700_000_000);
    const v = verifyJwt(token, secret, 1_700_000_010);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.claims.role).toBe("issuer");
      expect(v.claims.sub).toBe("cu_campususa");
    }
  });

  it("rejects expired", () => {
    const token = signJwt({ role: "correspondent", sub: "gulfside", ttlSec: 10 }, secret, 100);
    const v = verifyJwt(token, secret, 200);
    expect(v.ok).toBe(false);
  });

  it("rejects tampered payload", () => {
    const token = signJwt({ role: "issuer", sub: "x", ttlSec: 60 }, secret, 1000);
    const parts = token.split(".");
    parts[1] = parts[1]!.replace(/A/g, "B");
    const v = verifyJwt(parts.join("."), secret, 1010);
    expect(v.ok).toBe(false);
  });
});

describe("credentialGrantsRole with JWT", () => {
  it("accepts issuer JWT for issuer role", () => {
    const token = signJwt({ role: "issuer", sub: "iss", ttlSec: 60 }, secret);
    const r = credentialGrantsRole({ jwtSecret: secret }, token, "issuer");
    expect(r.ok).toBe(true);
  });

  it("rejects correspondent JWT for issuer role", () => {
    const token = signJwt({ role: "correspondent", sub: "c", ttlSec: 60 }, secret);
    const r = credentialGrantsRole({ jwtSecret: secret }, token, "issuer");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("still accepts static dual keys", () => {
    const r = credentialGrantsRole(
      { issuerKey: "iss-key", correspondentKey: "corr-key", jwtSecret: secret },
      "iss-key",
      "issuer",
    );
    expect(r.ok).toBe(true);
  });
});
