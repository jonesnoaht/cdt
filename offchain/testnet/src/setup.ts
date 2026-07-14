/**
 * `npm run setup` — generate (or reuse) the three preview-testnet wallets:
 *
 *   issuer  — the credit union: funds vaults, receives early-withdraw remainders;
 *   member  — the CD owner: receives the CDT and the payouts;
 *   oracle  — the deposit oracle: co-signs mints (extra required signatory).
 *
 * Keys are persisted under the gitignored `.keys/` directory and reused on
 * subsequent runs (idempotent). Addresses are public and printed for funding.
 */

import { loadWallets, lovelaceAt, makeLucid, fmtAda, KOIOS_URL } from "./common.js";

async function main(): Promise<void> {
  console.log(`Network: preview  (provider: ${KOIOS_URL})`);
  const lucid = await makeLucid();
  const wallets = await loadWallets(lucid);

  for (const wallet of Object.values(wallets)) {
    const balance = await lovelaceAt(lucid, wallet.address);
    console.log(`\n${wallet.name}`);
    console.log(`  address: ${wallet.address}`);
    console.log(`  vkh:     ${wallet.vkh}`);
    console.log(`  balance: ${fmtAda(balance)}`);
  }

  console.log(
    "\nKeys live in offchain/testnet/.keys/ (gitignored — never commit them).",
  );
  console.log("Next: npm run fund");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
