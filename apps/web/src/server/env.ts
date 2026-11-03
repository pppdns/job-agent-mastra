import "server-only";
import { z } from "zod";

const envSchema = z.object({
  AGENT_URL: z.url().default("http://127.0.0.1:4111"),
  AGENT_SHARED_SECRET: z.string().min(24, "must be at least 24 characters"),
});

/** Server-only config; validated lazily so `next build` doesn't need secrets. Reports names, never values. */
export function serverEnv(): z.infer<typeof envSchema> {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid web configuration (see .env.example):\n${problems.join("\n")}`);
  }
  return parsed.data;
}
