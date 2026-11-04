import {
  AssessmentError,
  type Db,
  factHandlesById,
  getJobDetail,
  latestListingSource,
  listJobs,
  proposeProfileChange,
  searchJobIds,
} from "@copilot/db";
import {
  type Assessment,
  allPoints,
  JOB_STATUSES,
  type JobStatus,
  profileProposalSchema,
} from "@copilot/shared";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { parseStoredListing } from "../../ingest/listing";
import { getAppDb } from "../app-db";
import { UNTRUSTED_NOTICE } from "./ingest-listing";

export const proposeProfileChangeTool = createTool({
  id: "propose_profile_change",
  description:
    "Propose an exact change to the user's approved global profile (add, modify or remove " +
    "facts; use fact handles like f7 from the profile in your instructions). Only for things the user wants " +
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

const MAX_STATUS_MATCHES = 30;
const MAX_TEXT_MATCHES = 5;
/** FTS candidates read before filtering by status/archive. */
const MAX_SEARCH_CANDIDATES = 500;

/**
 * Saved jobs by free text (FTS, best 5) and/or pipeline status (newest first). Without
 * `includeArchived`, archived jobs are left out unless the status filter asks for a closing one.
 */
export async function findSavedJobs(
  db: Db,
  input: { query?: string; status?: JobStatus; includeArchived?: boolean },
) {
  const { query, status } = input;
  const includeArchived =
    input.includeArchived ?? (status === "rejected" || status === "dismissed");
  // Filter before limiting, so archived or other-status hits don't crowd out eligible ones.
  const jobs = query
    ? await listJobs(db, await searchJobIds(db, query, MAX_SEARCH_CANDIDATES))
    : await listJobs(db);
  const limit = query ? MAX_TEXT_MATCHES : MAX_STATUS_MATCHES;
  const matches = jobs.filter(
    (j) => (!status || j.status === status) && (includeArchived || j.archivedAt === null),
  );
  return {
    matches: matches.slice(0, limit).map((j) => ({
      jobId: j.id,
      title: j.title,
      company: j.company,
      location: j.location,
      status: j.status,
      archived: j.archivedAt !== null,
      assessmentVersion: j.draftVersion,
      profileStale: j.profileStale,
    })),
    ...(matches.length > limit && { more: matches.length - limit }),
  };
}

export const findSavedJobsTool = createTool({
  id: "find_saved_jobs",
  description:
    "Find saved jobs by company, title, location or assessment text (e.g. 'Acme platform'; " +
    "at most 5 matches) and/or by pipeline status (e.g. status 'applied' for 'what did I apply " +
    "to?'). Archived jobs are left out unless includeArchived is true or the status is " +
    "rejected/dismissed. If several could be what the user means, ask which one.",
  inputSchema: z
    .object({
      query: z.string().trim().min(1).max(200).optional(),
      status: z.enum(JOB_STATUSES).optional(),
      includeArchived: z.boolean().optional(),
    })
    .refine((i) => i.query || i.status || i.includeArchived, {
      message: "give a query, a status, or includeArchived",
    }),
  execute: async (input) => findSavedJobs(await getAppDb(), input),
});

/** Stored drafts cite full fact ids; show the model the handles it cites with (f7). */
function withFactHandles(assessment: Assessment, handles: Map<string, string>): Assessment {
  const copy = structuredClone(assessment);
  for (const point of allPoints(copy)) {
    point.profileFactIds = point.profileFactIds.map((id) => handles.get(id) ?? id);
  }
  return copy;
}

export const getJobTool = createTool({
  id: "get_job",
  description:
    "Load one saved job: identity, sources read, the current assessment (with its version), " +
    "and whether it predates the current approved profile. " +
    "Pass includeListing: true to also get the stored listing text, e.g. to re-assess the job " +
    "against the current profile without reading it again.",
  inputSchema: z.object({
    jobId: z.string().min(1).max(64),
    includeListing: z
      .boolean()
      .optional()
      .describe("Also return the most recently read listing text"),
  }),
  execute: async ({ jobId, includeListing }) => {
    const db = await getAppDb();
    const detail = await getJobDetail(db, jobId);
    if (!detail) return { ok: false as const, error: `no saved job with id ${jobId}` };
    const source = includeListing ? await latestListingSource(db, jobId) : undefined;
    return {
      ok: true as const,
      job: {
        jobId: detail.job.id,
        title: detail.job.title,
        company: detail.job.company,
        location: detail.job.location,
        status: detail.job.status,
        archived: detail.job.archivedAt !== null,
      },
      sources: detail.sources.map((s) => ({ id: s.id, kind: s.kind, url: s.url })),
      currentProfileVersion: detail.profileVersion,
      profileStale: detail.profileStale,
      current: detail.draft && {
        version: detail.draft.version,
        profileVersion: detail.draft.profileVersion,
        assessment: withFactHandles(detail.draft.assessment, await factHandlesById(db)),
      },
      ...(source && {
        listing: {
          sourceId: source.id,
          kind: source.kind,
          truncated: source.truncated,
          ...parseStoredListing(source.kind, source.content),
        },
        notice: UNTRUSTED_NOTICE,
      }),
    };
  },
});
