/**
 * Lab remote signer — stand-in for an HSM sidecar.
 *
 * Loads ORACLE_SIGNING_KEY_PEM (or ephemeral), exposes:
 *   GET  /health  → { ok, publicKeySpkiBase64 }
 *   POST /sign    → { signature, publicKeySpkiBase64 }
 *
 * Usage:
 *   ORACLE_SIGNING_KEY_PEM=… PORT=9090 npx tsx scripts/remote-signer-lab.ts
 *   ORACLE_SIGNING_PROVIDER=remote ORACLE_REMOTE_SIGNER_URL=http://127.0.0.1:9090/sign …
 */
import { createServer } from "node:http";
import { createPublicKey } from "node:crypto";
import {
  generateEd25519KeyPair,
  privateKeyFromPem,
  publicKeyToBase64,
  signUtf8,
} from "../src/keys.js";

const pem = process.env.ORACLE_SIGNING_KEY_PEM;
const privateKey = pem
  ? privateKeyFromPem(pem)
  : generateEd25519KeyPair().privateKey;
if (!pem) {
  console.warn("remote-signer-lab: ephemeral key (set ORACLE_SIGNING_KEY_PEM for stable pins)");
}
const pubB64 = publicKeyToBase64(createPublicKey(privateKey));
const port = Number(process.env.PORT || 9090);
const token = process.env.ORACLE_REMOTE_SIGNER_TOKEN;

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  if (token) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${token}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
  }
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, publicKeySpkiBase64: pubB64 }));
    return;
  }
  if (req.method === "POST" && (url.pathname === "/sign" || url.pathname === "/")) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: { message?: string };
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
        message?: string;
      };
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid json" }));
      return;
    }
    if (typeof body.message !== "string") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "message required" }));
      return;
    }
    const signature = signUtf8(body.message, privateKey);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ signature, publicKeySpkiBase64: pubB64 }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`remote-signer-lab: http://127.0.0.1:${port}/sign`);
  console.log(`remote-signer-lab: public SPKI = ${pubB64}`);
});
