import {
  AssessmentError,
  getJobDetail,
  listJobs,
  proposeProfileChange,
  searchJobIds,
} from "@copilot/db";
import { profileProposalSchema } from "@copilot/shared";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getAppDb } from "../app-db";

export const proposeProfileChangeTool = createTool({
  id: "propose_profile_change",
  description:
    "Propose an exact change to the user's approved global profile (add, modify or remove " +
    "facts; use fact ids from the profile in your instructions). Only for things the user wants " +
    "remembered beyond this chat. The user approves it in the app; nothing changes before that.",
  inputSchema: profileProposalSchema,
  execute: async (proposal, context) => {
    const threadId = context?.agent?.threadId;
    if (!threadId) return { ok: false as const, error: "proposals need a chat thread" };
    try {
      const { approval, created } = await proposeProfileChange(await getAppDb(), {
        threadId,
        proposal,
      });
      return {
        ok: true as const,
        approvalId: approval.id,
        status: approval.status,
        created,
        note: "Waiting for the user's decision in the app. Until then the profile is unchanged.",
      };
    } catch (error) {
      if (error instanceof AssessmentError) return { ok: false as const, error: error.message };
      throw error;
    }
  },
});

export const findSavedJobsTool = createTool({
  id: "find_saved_jobs",
  description:
    "Search saved jobs by company, title, location or assessment text (e.g. 'Acme platform'). " +
    "Returns at most 5 matches. If several could be what the user means, ask which one.",
  inputSchema: z.object({ query: z.string().trim().min(1).max(200) }),
  execute: async ({ query }) => {
    const db = await getAppDb();
    const jobs = await listJobs(db, await searchJobIds(db, query, 5));
    return {
      matches: jobs.map((j) => ({
        jobId: j.id,
        title: j.title,
        company: j.company,
        location: j.location,
        draftVersion: j.draftVersion,
        approvedVersion: j.approvedVersion,
        profileStale: j.profileStale,
      })),
    };
  },
});

export const getJobTool = createTool({
  id: "get_job",
  description:
    "Load one saved job: identity, sources read, the latest draft assessment, the latest " +
    "approved snapshot, and whether the assessment predates the current approved profile.",
  inputSchema: z.object({ jobId: z.string().min(1).max(64) }),
  execute: async ({ jobId }) => {
    const detail = await getJobDetail(await getAppDb(), jobId);
    if (!detail) return { ok: false as const, error: `no saved job with id ${jobId}` };
    const latest = detail.snapshots[0];
    return {
      ok: true as const,
      job: {
        jobId: detail.job.id,
        title: detail.job.title,
        company: detail.job.company,
        location: detail.job.location,
      },
      sources: detail.sources.map((s) => ({ id: s.id, kind: s.kind, url: s.url })),
      currentProfileVersion: detail.profileVersion,
      profileStale: detail.profileStale,
      draft: detail.draft && {
        version: detail.draft.version,
        profileVersion: detail.draft.profileVersion,
        assessment: detail.draft.assessment,
      },
      approved: latest && {
        version: latest.version,
        fromDraftVersion: latest.payload.draftVersion,
        approvedAt: latest.createdAt.toISOString(),
      },
      pendingApproval: detail.pending.length > 0,
    };
  },
});
