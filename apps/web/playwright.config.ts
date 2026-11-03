import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

// Isolated stack: own ports, own database, deterministic mock model, throwaway secret.
const secret = "e2e-secret-e2e-secret-e2e-secret";
const agentPort = 4112;
const webPort = 3001;
const e2eDbPath = resolve(import.meta.dirname, "../../data/e2e.db");
export const e2eDb = `file:${e2eDbPath}`;
export const e2eAgentUrl = `http://127.0.0.1:${agentPort}`;
export const e2eSecret = secret;

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
      // Fresh database per run, so tests never see leftovers.
      command: `rm -f ${e2eDbPath} ${e2eDbPath}-shm ${e2eDbPath}-wal && pnpm --filter @copilot/agent dev`,
      url: `${e2eAgentUrl}/api`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        LLM_MODE: "mock",
        AGENT_PORT: String(agentPort),
        AGENT_SHARED_SECRET: secret,
        DATABASE_URL: e2eDb,
        // Blank the web provider keys `mastra dev` would load from .env: no live calls in e2e.
        TAVILY_API_KEY: "",
        // Research runs read synthetic pages from fixtures/web.
        WEB_MODE: "fixture",
        FIRECRAWL_API_KEY: "",
      },
    },
    {
      command: `pnpm exec next dev --hostname 127.0.0.1 --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        AGENT_URL: e2eAgentUrl,
        AGENT_SHARED_SECRET: secret,
        DATABASE_URL: e2eDb,
      },
    },
  ],
});
