/** CLI entry point for `npm run seed`. Idempotent — safe to re-run. */
import { createPool } from "../src/db.js";
import { seed } from "../src/seed.js";

const pool = createPool();
try {
  const result = await seed(pool);
  console.log(`seeded ${result.productIds.length} CD products`);
  console.log(
    `seeded ${result.checkingIds.length} members (checking + cd_funding each)`,
  );
  console.log(
    `seeded 3 checking deposits and ${result.cdDepositTxIds.length} CD-funding deposits`,
  );
  console.log("seed complete");
} finally {
  await pool.end();
}
