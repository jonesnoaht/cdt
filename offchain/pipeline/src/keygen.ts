/**
 * `npm run keygen [-- --out <dir>]` — generate the key files preview mode
 * needs (never commit them; the default `keys/` directory is gitignored):
 *
 *   issuer.sk             bech32 ed25519 payment key (CDT_ISSUER_SK_FILE)
 *   oracle.sk             bech32 ed25519 payment key (CDT_ORACLE_SK_FILE)
 *   member.sk             bech32 ed25519 payment key (CDT_MEMBER_SK_FILE)
 *   oracle-attestation.pem PKCS#8 Ed25519 PEM        (CDT_ORACLE_ATTESTATION_SK_FILE)
 *
 * Prints each key's preview address so the wallets can be funded from the
 * testnet faucet.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  CML,
  credentialToAddress,
  generatePrivateKey,
} from "./lucid.js";
import {
  generateEd25519KeyPair,
  privateKeyToPem,
} from "../../oracle-watcher/src/index.ts";

function addressOf(bech32Sk: string): string {
  const vkh = CML.PrivateKey.from_bech32(bech32Sk)
    .to_public()
    .hash()
    .to_hex();
  return credentialToAddress("Preview", { type: "Key", hash: vkh });
}

function main(): void {
  const { values } = parseArgs({
    options: { out: { type: "string", default: "keys" } },
  });
  const outDir = resolve(values.out ?? "keys");
  mkdirSync(outDir, { recursive: true });

  for (const name of ["issuer", "oracle", "member"] as const) {
    const sk = generatePrivateKey();
    const file = join(outDir, `${name}.sk`);
    writeFileSync(file, sk + "\n", { mode: 0o600 });
    console.log(`${name.padEnd(7)} ${file}`);
    console.log(`        preview address: ${addressOf(sk)}`);
  }

  // Same helpers the watcher uses to load the key back (privateKeyFromPem).
  const { privateKey } = generateEd25519KeyPair();
  const pemFile = join(outDir, "oracle-attestation.pem");
  writeFileSync(pemFile, privateKeyToPem(privateKey), { mode: 0o600 });
  console.log(`oracle-attestation ${pemFile}`);
  console.log(
    "\nFund the issuer (and member) addresses from https://docs.cardano.org/cardano-testnets/tools/faucet",
  );
}

main();
