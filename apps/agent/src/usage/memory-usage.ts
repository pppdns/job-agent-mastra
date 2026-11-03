import { currentOrLastRun, recordRunEvents } from "@copilot/db";
import { env } from "../env";
import { getAppDb } from "../mastra/app-db";
import { estimateLlmUsd } from "./prices";

/**
 * One event per background model call (Observational Memory, chat titles). These run
 * outside the agent's steps, so the call is
 * attached to the chat's active run, or its latest one. Failures never affect the chat.
 */
export async function recordMemoryCall(
  kind: "observation" | "reflection" | "title",
  threadId: string | undefined,
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
  error?: Error,
): Promise<void> {
  if (!threadId) return;
  try {
    const db = await getAppDb();
    const run = await currentOrLastRun(db, threadId);
    if (!run) return;
    await recordRunEvents(db, [
      {
        runId: run.id,
        type: "llm",
        category: kind === "title" ? "llm" : "memory",
        name: env.COPILOT_FAST_MODEL,
        actor: kind === "observation" ? "observer" : kind === "reflection" ? "reflector" : "title",
        status: error ? "error" : "ok",
        at: new Date(),
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        estimatedUsd: estimateLlmUsd(env.COPILOT_FAST_MODEL, usage ?? {}),
        data: error ? { error: error.message.slice(0, 300) } : null,
      },
    ]);
  } catch (e) {
    console.error("could not record memory usage", e);
  }
}
