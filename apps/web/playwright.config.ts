import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

// Isolated stack: own ports, own database, deterministic mock model, throwaway secret.
const secret = "e2e-secret-e2e-secret-e2e-secret";
const agentPort = 4112;
const webPort = 3001;
const e2eDb = `file:${resolve(import.meta.dirname, "../../data/e2e.db")}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @copilot/agent dev",
      url: `http://127.0.0.1:${agentPort}/api`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        LLM_MODE: "mock",
        AGENT_PORT: String(agentPort),
        AGENT_SHARED_SECRET: secret,
        DATABASE_URL: e2eDb,
      },
    },
    {
      command: `pnpm exec next dev --hostname 127.0.0.1 --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        AGENT_URL: `http://127.0.0.1:${agentPort}`,
        AGENT_SHARED_SECRET: secret,
      },
    },
  ],
});
