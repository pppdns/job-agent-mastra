import { defineConfig } from "vitest/config";

// `pnpm listings:live`: the listing checkers against real listings (src/listings/corpus.json).
// Live HTTP to LinkedIn and the job boards; no keys, no database. Not part of `pnpm check`.
export default defineConfig({
  test: {
    include: ["src/listings/**/*.live.ts"],
    testTimeout: 10 * 60_000,
    env: { LLM_MODE: "mock", AGENT_SHARED_SECRET: "test-secret-test-secret-test" },
  },
});
