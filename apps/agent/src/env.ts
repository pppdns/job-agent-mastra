import { z } from "zod";

const envSchema = z.object({
  LLM_MODE: z.enum(["live", "mock"]).default("live"),
  AI_GATEWAY_API_KEY: z.string().min(1).optional(),
  // Vercel AI Gateway model ids (provider/model)
  COPILOT_MODEL: z.string().min(1).default("anthropic/claude-sonnet-5.5"),
  COPILOT_FAST_MODEL: z.string().min(1).default("anthropic/claude-haiku-5.5"),
  AGENT_SHARED_SECRET: z.string().min(24, "must be at least 24 characters"),
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
