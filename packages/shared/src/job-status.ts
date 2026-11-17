/** Where a job stands in the user's own search (manual bookkeeping, no external actions). */
export const JOB_STATUSES = [
  "new",
  "shortlisted",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "dismissed",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  new: "New",
  shortlisted: "Shortlisted",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  dismissed: "Dismissed",
};

/** Statuses that close a job: setting one archives it. */
export const CLOSED_JOB_STATUSES: readonly JobStatus[] = ["rejected", "dismissed"];

/** Statuses in progress, in pipeline order: the columns of the board. */
export const PIPELINE_STATUSES = ["shortlisted", "applied", "interviewing", "offer"] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

/** Upper bound for interview rounds the user can set. */
export const MAX_INTERVIEW_ROUNDS = 12;

/** Upper bound for a job's note. */
export const MAX_JOB_NOTES_CHARS = 20_000;
