import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

// `pnpm eval`: real models (agent + judge) on fixtures, in its own database (data/eval.db),
// so evals never touch the dev data. The gateway key and secret come from apps/agent/.env.
const envFile = resolve(import.meta.dirname, ".env");
const dotenv: Record<string, string | undefined> = existsSync(envFile)
  ? parseEnv(readFileSync(envFile, "utf8"))
  : {};
const evalDb = resolve(import.meta.dirname, "../../data/eval.db");

export default defineConfig({
  test: {
    include: ["src/evals/**/*.eval.ts"],
    testTimeout: 30 * 60_000,
    hookTimeout: 30 * 60_000,
    env: {
      AI_GATEWAY_API_KEY: dotenv.AI_GATEWAY_API_KEY ?? "",
      AGENT_SHARED_SECRET: dotenv.AGENT_SHARED_SECRET ?? "",
      ...(dotenv.COPILOT_MODEL ? { COPILOT_MODEL: dotenv.COPILOT_MODEL } : {}),
      ...(dotenv.EVAL_JUDGE_MODEL ? { EVAL_JUDGE_MODEL: dotenv.EVAL_JUDGE_MODEL } : {}),
      LLM_MODE: "live",
      DATABASE_URL: `file:${evalDb}`,
      // Research reads fixtures/web; no live web calls.
      WEB_MODE: "fixture",
      TAVILY_API_KEY: "",
      FIRECRAWL_API_KEY: "",
    },
  },
});
