import "server-only";
import { z } from "zod";

const envSchema = z.object({
  // Same variable the agent listens on; per checkout via scripts/ports.sh. Never a remote host.
  AGENT_PORT: z.coerce.number().int().min(1).max(65_535).default(4111),
  AGENT_SHARED_SECRET: z.string().min(24, "must be at least 24 characters"),
});

/** Server-only config; validated lazily so `next build` doesn't need secrets. Reports names, never values. */
export function serverEnv(): z.infer<typeof envSchema> & { AGENT_URL: string } {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid web configuration (see .env.example):\n${problems.join("\n")}`);
  }
  return { ...parsed.data, AGENT_URL: `http://127.0.0.1:${parsed.data.AGENT_PORT}` };
}
