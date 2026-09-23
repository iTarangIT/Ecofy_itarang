import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/helpers/setup.ts"],
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false, // integration tests share one database
    sequence: { concurrent: false },
  },
});
