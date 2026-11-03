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
