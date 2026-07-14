import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // The vite dev server proxies API calls to the local API server
      // (`npm run api`, default port 8787).
      "/api": `http://localhost:${process.env.PORT || 8787}`,
    },
  },
  build: {
    outDir: "dist/ui",
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // All test files share one Postgres database; run them sequentially.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
