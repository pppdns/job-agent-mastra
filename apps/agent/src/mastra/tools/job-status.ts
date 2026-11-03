import { type Db, setJobStatus } from "@copilot/db";
import { JOB_STATUSES, type JobStatus } from "@copilot/shared";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getAppDb } from "../app-db";

/** Sets a saved job's pipeline status; the result says whether the job is now archived. */
export async function updateJobStatus(db: Db, jobId: string, status: JobStatus) {
  const job = await setJobStatus(db, jobId, status);
  if (!job) return { ok: false as const, error: `no saved job with id ${jobId}` };
  return {
    ok: true as const,
    jobId: job.id,
    title: job.title,
    company: job.company,
    status: job.status,
    archived: job.archivedAt !== null,
  };
}

export const setJobStatusTool = createTool({
  id: "set_job_status",
  description:
    "Set where a saved job stands in the user's own search: new, shortlisted, applied, " +
    "interviewing, offer, rejected or dismissed. Rejected and dismissed archive the job; any " +
    "other status unarchives it. Only when the user asks for it; this is bookkeeping, nothing " +
    "is sent anywhere.",
  inputSchema: z.object({
    jobId: z.string().min(1).max(64),
    status: z.enum(JOB_STATUSES),
  }),
  execute: async ({ jobId, status }) => updateJobStatus(await getAppDb(), jobId, status),
});
