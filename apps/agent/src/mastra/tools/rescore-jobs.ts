import { DEFAULT_RESCORE_LIMIT } from "@copilot/shared";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { type RescoreResult, runRescore } from "../../rescore/run";
import { recorderFor } from "../../usage/recorder";
import { getAppDb } from "../app-db";

export const rescoreJobsTool = createTool({
  id: "rescore_jobs",
  description:
    "Re-assess saved jobs against the current approved profile, each in its own model call, " +
    "and save each result as the job's new current version. Without jobIds: every job whose " +
    "assessment predates the current profile (archived jobs skipped). " +
    "With all: every assessed, non-archived job, stale ones first, then least recently updated. " +
    `At most limit jobs per call (default ${DEFAULT_RESCORE_LIMIT}, "all" for no cap); call again for the next batch.`,
  inputSchema: z.object({
    jobIds: z
      .array(z.string().min(1).max(64))
      .min(1)
      .max(1000)
      .optional()
      .describe("Specific jobs to re-score; omit for all stale, non-archived jobs"),
    all: z
      .boolean()
      .optional()
      .describe("Re-score every assessed, non-archived job, not only stale ones"),
    limit: z
      .union([z.number().int().min(1), z.literal("all")])
      .optional()
      .describe(
        `Most jobs to re-score in this call (default ${DEFAULT_RESCORE_LIMIT}); "all" for no cap`,
      ),
  }),
  execute: async (input, context) =>
    runRescore(input, {
      db: await getAppDb(),
      threadId: context?.agent?.threadId,
      signal: context?.abortSignal,
      tracingContext: context?.tracingContext,
      recorder: recorderFor(context?.agent?.threadId),
      emit: (data) => context?.writer?.custom({ type: "data-rescore-progress", data }),
    }),
  // The app shows every result; a big batch would flood the model's context with them.
  toModelOutput: (output) => ({ type: "json", value: forModel(output as RescoreOutput) }),
});

/** Results the model sees in full; above this, counts plus the failures only. */
const MODEL_RESULTS = 25;

type RescoreOutput = Awaited<ReturnType<typeof runRescore>>;

export function forModel(output: RescoreOutput) {
  const { results, ...rest } = output;
  if (results.length <= MODEL_RESULTS) return output;
  const saved = results.filter((r) => r.status === "saved");
  const failed = results.filter(
    (r): r is Extract<RescoreResult, { status: "failed" }> => r.status === "failed",
  );
  return {
    ...rest,
    saved: saved.length,
    verdictChanged: saved.filter((r) => r.before.verdict !== r.after.verdict).length,
    fitChanged: saved.filter((r) => r.before.fitLevel !== r.after.fitLevel).length,
    failed: failed.length,
    failures: failed
      .slice(0, MODEL_RESULTS)
      .map(({ title, company, reason }) => ({ title, company, reason })),
  };
}
