import { defineConfig } from "vitest/config";

/** Shared Postgres — run files serially to avoid seed TRUNCATE deadlocks. */
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
