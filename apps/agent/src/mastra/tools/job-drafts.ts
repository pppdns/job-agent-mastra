import { AssessmentError, listJobs, saveDraft } from "@copilot/db";
import { assessmentSchema } from "@copilot/shared";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getAppDb } from "../app-db";

const jobIdSchema = z.string().min(1).max(64).describe("jobId returned by ingest_listing");

/** Turns deterministic rule violations into a result the model can fix and retry. */
async function guarded<T>(fn: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AssessmentError) return { ok: false, error: error.message };
    throw error;
  }
}

export const saveJobDraftTool = createTool({
  id: "save_job_draft",
  description:
    "Save your current assessment of a job as its new current version (no approval; earlier " +
    "versions stay as history). " +
    "Call it after an initial assessment and whenever the assessment changes materially. " +
    "Cite source ids for listing/official/independent/anonymous evidence: the listing's from " +
    "ingest_listing, and for research claims the claim's sourceIds (never its claimId). Mark " +
    "your own conclusions as inference.",
  inputSchema: z.object({ jobId: jobIdSchema, assessment: assessmentSchema }),
  execute: async ({ jobId, assessment }, context) =>
    guarded(async () => {
      const db = await getAppDb();
      const draft = await saveDraft(db, { jobId, assessment, threadId: context?.agent?.threadId });
      const [job] = await listJobs(db, [jobId]);
      // title/company label the chat's assessment card
      return {
        ok: true as const,
        jobId,
        draftId: draft.id,
        version: draft.version,
        title: job?.title ?? null,
        company: job?.company ?? null,
      };
    }),
});
