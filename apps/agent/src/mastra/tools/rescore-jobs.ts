import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { MAX_RESCORE_JOBS, runRescore } from "../../rescore/run";
import { recorderFor } from "../../usage/recorder";
import { getAppDb } from "../app-db";

export const rescoreJobsTool = createTool({
  id: "rescore_jobs",
  description:
    "Re-assess saved jobs against the current approved profile, each in its own model call, " +
    "and save each result as a new draft (not approved). Without jobIds: every job whose " +
    `assessment predates the current profile (archived jobs skipped), at most ${MAX_RESCORE_JOBS} per call.`,
  inputSchema: z.object({
    jobIds: z
      .array(z.string().min(1).max(64))
      .min(1)
      .max(MAX_RESCORE_JOBS)
      .optional()
      .describe("Specific jobs to re-score; omit for all stale, non-archived jobs"),
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
});
