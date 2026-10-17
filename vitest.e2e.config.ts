import { defineConfig } from "vitest/config";

// browser tests (need Chrome and apps/web/dist): npm run test:e2e
export default defineConfig({
  test: { include: ["tests/web/**/*.e2e.ts"], testTimeout: 120000, hookTimeout: 120000, fileParallelism: false },
});
