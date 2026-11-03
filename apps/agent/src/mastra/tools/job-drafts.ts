import {
  AssessmentError,
  listJobs,
  proposeSnapshot,
  saveDraft,
  snapshotPayloadOf,
} from "@copilot/db";
import { assessmentSchema, RECOMMENDATION_LABELS } from "@copilot/shared";
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
    "Save your current assessment of a job as a new draft version (automatic, no approval). " +
    "Call it after an initial assessment and whenever the assessment changes materially. " +
    "Cite the source ids from ingest_listing for listing/official/independent/anonymous " +
    "evidence; mark your own conclusions as inference.",
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

export const proposeJobSnapshotTool = createTool({
  id: "propose_job_snapshot",
  description:
    "Propose saving the job's latest draft as an approved snapshot. The user approves or " +
    "rejects it in the app; you cannot approve it and must not say it is saved until they do. " +
    "Only call this when the user wants to finalize or save the assessment.",
  inputSchema: z.object({ jobId: jobIdSchema }),
  execute: async ({ jobId }, context) =>
    guarded(async () => {
      const threadId = context?.agent?.threadId;
      if (!threadId) return { ok: false as const, error: "proposals need a chat thread" };
      const { approval, created } = await proposeSnapshot(await getAppDb(), { jobId, threadId });
      const payload = snapshotPayloadOf(approval);
      return {
        ok: true as const,
        approvalId: approval.id,
        status: approval.status,
        created,
        draftVersion: approval.draftVersion,
        summary: {
          title: payload.job.title,
          company: payload.job.company,
          recommendation: RECOMMENDATION_LABELS[payload.assessment.recommendation.verdict],
        },
        note: "Waiting for the user's decision in the app.",
      };
    }),
});
