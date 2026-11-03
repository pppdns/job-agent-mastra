import { z } from "zod";

/** Optional secret; an empty string counts as unset (e2e blanks keys that `mastra dev` would load from .env). */
const optionalKey = z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());

const envSchema = z.object({
  LLM_MODE: z.enum(["live", "mock"]).default("live"),
  AI_GATEWAY_API_KEY: optionalKey,
  // Vercel AI Gateway model ids (provider/model)
  COPILOT_MODEL: z.string().min(1).default("anthropic/claude-sonnet-5.5"),
  COPILOT_FAST_MODEL: z.string().min(1).default("anthropic/claude-haiku-5.5"),
  AGENT_SHARED_SECRET: z.string().min(24, "must be at least 24 characters"),
  // Observational Memory: unobserved message tokens that trigger compaction (Mastra default 30k).
  // Tests force a tiny value to exercise compaction offline.
  OM_MESSAGE_TOKENS: z.coerce.number().int().min(100).default(30_000),
  // Web providers. Without them, URL ingestion asks the user to paste the listing.
  // "fixture" serves fixtures/web instead of Tavily (offline e2e/evals); never in normal use.
  WEB_MODE: z.enum(["live", "fixture"]).default("live"),
  TAVILY_API_KEY: optionalKey,
  FIRECRAWL_API_KEY: optionalKey,
});

export type Env = z.infer<typeof envSchema>;

/** Validates process.env; reports variable names only, never values. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid agent configuration (see .env.example):\n${problems.join("\n")}`);
  }
  if (parsed.data.LLM_MODE === "live" && !parsed.data.AI_GATEWAY_API_KEY) {
    throw new Error(
      "Invalid agent configuration: AI_GATEWAY_API_KEY is required when LLM_MODE=live",
    );
  }
  return parsed.data;
}

export const env = loadEnv();
