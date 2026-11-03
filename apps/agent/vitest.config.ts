import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      LLM_MODE: "mock",
      AGENT_SHARED_SECRET: "test-secret-test-secret-test",
    },
  },
});
