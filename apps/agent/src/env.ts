import { z } from "zod";

/** Surrounding whitespace (incl. \r) and quotes pasted along with a key. */
const cleanKey = (v: unknown) =>
  typeof v === "string"
    ? v
        .trim()
        .replace(/^(["'])(.*)\1$/, "$2")
        .trim()
    : v;

/** Optional secret; an empty string counts as unset (e2e blanks keys that `mastra dev` would load from .env). */
const optionalKey = z.preprocess((v) => {
  const key = cleanKey(v);
  return key === "" ? undefined : key;
}, z.string().min(1).optional());

const envSchema = z.object({
  LLM_MODE: z.enum(["live", "mock"]).default("live"),
  AI_GATEWAY_API_KEY: optionalKey,
  // Vercel AI Gateway model ids (provider/model)
  COPILOT_MODEL: z.string().min(1).default("anthropic/claude-sonnet-5.5"),
  COPILOT_FAST_MODEL: z.string().min(1).default("anthropic/claude-haiku-5.5"),
  // LLM judge for scorers (live sampling and `pnpm eval`): another provider than the copilot.
  EVAL_JUDGE_MODEL: z.string().min(1).default("openai/gpt-6.1-sol"),
  AGENT_SHARED_SECRET: z.string().min(24, "must be at least 24 characters"),
  // Observational Memory: unobserved message tokens that trigger compaction (Mastra default 30k).
  // Tests force a tiny value to exercise compaction offline.
  OM_MESSAGE_TOKENS: z.coerce.number().int().min(100).default(30_000),
  // Web providers. Without them, URL ingestion asks the user to paste the listing.
  // "fixture" serves fixtures/web instead of Tavily (offline e2e/evals); never in normal use.
  WEB_MODE: z.enum(["live", "fixture"]).default("live"),
  TAVILY_API_KEY: optionalKey,
  FIRECRAWL_API_KEY: optionalKey,
  // Job discovery. Apify runs the paid board scrapers (LinkedIn); without it they are skipped.
  APIFY_API_KEY: optionalKey,
  // Optional free Himalayas key (higher rate limits); the API works without one.
  HIMALAYAS_API_KEY: optionalKey,
  // "on" schedules discovery twice a day, but only in the main checkout's dev server
  // (see discoveryScheduleEnabled); worktrees, e2e and evals never schedule.
  DISCOVERY_SCHEDULE: z.enum(["on", "off"]).default("off"),
  DISCOVERY_TZ: z.string().min(1).default("Europe/Budapest"),
  // Email digest after each run (Resend). Without the key or a recipient it is skipped.
  RESEND_API_KEY: optionalKey,
  DIGEST_TO: optionalKey,
  // Resend's test sender delivers only to your Resend account's own address; use a verified
  // domain's address to send elsewhere.
  DIGEST_FROM: z.string().min(3).default("Job Research Copilot <onboarding@resend.dev>"),
  // Where the email's links point (the web app).
  APP_BASE_URL: z.string().url().default("http://127.0.0.1:3000"),
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
