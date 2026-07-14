import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The e2e suite drives docker Postgres + a Lucid emulator; give it room.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // DB state is shared between suites; keep them sequential.
    fileParallelism: false,
  },
});
