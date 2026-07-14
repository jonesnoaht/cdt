import pg from "pg";
import { seedFixture } from "/home/noahtjones/cdt/.claude/worktrees/agent-a5adf1c843399b6f9/webapp/test/fixtures/seed.js";
async function main() {
  const pool = new pg.Pool({ host: "127.0.0.1", port: 55435, user: "bank", password: "bank", database: "bank_sim" });
  await seedFixture(pool);
  await pool.end();
  console.log("seeded");
}
main().catch((e) => { console.error(e); process.exit(1); });
