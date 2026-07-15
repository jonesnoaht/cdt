/**
 * Pilot key ceremony — generate Ed25519 PEMs for oracle / payment / settlement.
 *
 * Never prints private PEM to logs when writing to files; only public SPKI.
 *
 * Usage:
 *   cd webapp && npm run keygen:pilot
 *   OUT_DIR=./keys npm run keygen:pilot
 *
 * Dual-control ops: generate two settlement keys; only the primary signs in
 * software today. Store the secondary under HSM / dual custody for future
 * cosign (documented in docs/ops/key-ceremony.md).
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";

function generateEd25519(): { privatePem: string; publicSpkiB64: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicSpkiB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return { privatePem, publicSpkiB64 };
}

const outDir = process.env.OUT_DIR || join(process.cwd(), "keys-pilot");
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
}

const roles = [
  { name: "oracle", envPrivate: "ORACLE_SIGNING_KEY_PEM", envPub: "MINT_ORACLE_PUBKEY_SPKI" },
  {
    name: "payment-oracle",
    envPrivate: "PAYMENT_ORACLE_SIGNING_KEY_PEM",
    envPub: "PAYMENT_ORACLE_PUBKEY_SPKI",
  },
  {
    name: "settlement",
    envPrivate: "SETTLEMENT_SIGNING_KEY_PEM",
    envPub: "SETTLEMENT_PUBKEY_SPKI",
  },
  {
    name: "settlement-secondary",
    envPrivate: "SETTLEMENT_SECONDARY_SIGNING_KEY_PEM",
    envPub: "SETTLEMENT_SECONDARY_PUBKEY_SPKI",
  },
] as const;

const pins: string[] = [];
console.log(`Writing PEMs under ${outDir} (mode 0600 for private keys)\n`);

for (const role of roles) {
  const { privatePem, publicSpkiB64 } = generateEd25519();
  const privPath = join(outDir, `${role.name}.private.pem`);
  const pubPath = join(outDir, `${role.name}.spki.b64`);
  writeFileSync(privPath, privatePem, { mode: 0o600 });
  chmodSync(privPath, 0o600);
  writeFileSync(pubPath, publicSpkiB64 + "\n", { mode: 0o644 });
  // Public only to console
  console.log(`${role.name}`);
  console.log(`  private → ${privPath}`);
  console.log(`  public  → ${pubPath}`);
  console.log(`  SPKI    = ${publicSpkiB64}`);
  console.log(`  pin     : export ${role.envPub}='${publicSpkiB64}'`);
  console.log(`  load    : export ${role.envPrivate}=\"$(cat ${privPath})\"`);
  console.log("");
  pins.push(`${role.envPub}=${publicSpkiB64}`);
}

// Also generate a JWT secret and dual API keys for pilot
const jwtSecret = generateKeyPairSync("ed25519")
  .privateKey.export({ type: "pkcs8", format: "der" })
  .toString("base64")
  .slice(0, 48);
const apiIssuer = generateKeyPairSync("ed25519")
  .privateKey.export({ type: "pkcs8", format: "der" })
  .toString("base64")
  .slice(0, 32);
const apiCorr = generateKeyPairSync("ed25519")
  .privateKey.export({ type: "pkcs8", format: "der" })
  .toString("base64")
  .slice(0, 32);

const envSnippet = join(outDir, "pilot.env.example");
writeFileSync(
  envSnippet,
  [
    "# Pilot env — fill PEMs from files; never commit this directory.",
    "NODE_ENV=production",
    "HOST=127.0.0.1",
    "PGPASSWORD=",
    `CDT_ISSUER_API_KEY=${apiIssuer}`,
    `CDT_CORRESPONDENT_API_KEY=${apiCorr}`,
    `CDT_JWT_SECRET=${jwtSecret}`,
    "CDT_VC_MODE=credentials",
    "BURN_VALIDATE_MODE=strict",
    "CHAIN_PROVIDER=koios-preview",
    "SETTLEMENT_RAIL=mock",
    "# ORACLE_SIGNING_KEY_PEM=... (from oracle.private.pem)",
    "# PAYMENT_ORACLE_SIGNING_KEY_PEM=... (from payment-oracle.private.pem)",
    "# SETTLEMENT_SIGNING_KEY_PEM=... (from settlement.private.pem)",
    ...pins,
    "",
  ].join("\n"),
  { mode: 0o600 },
);

console.log(`Wrote ${envSnippet}`);
console.log("Dual-control: keep settlement-secondary.private.pem offline / HSM-only.");
console.log("Ceremony complete. Do not commit keys-pilot/.");
