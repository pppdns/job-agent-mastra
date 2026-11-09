import type { JobOverview } from "@copilot/db";
import type { JobStatus } from "@copilot/shared";
import type { JobTab } from "./job-list";

// What the /jobs table emphasizes, so color marks decisions that are still open:
// fit keeps its color while it still drives a decision, the age column measures what matters
// on the tab, and the status pill stands out only where it tells rows apart.

/** Tabs where the user waits on or works with the employer: the age column shows time in stage. */
const STAGE_TABS: readonly JobTab[] = ["applied", "interviewing", "offer"];

export const showsStageAge = (tab: JobTab) => STAGE_TABS.includes(tab);

/** Waiting on the employer or closed: the fit judgement no longer drives anything. */
const FIT_SETTLED: readonly JobStatus[] = ["applied", "rejected", "dismissed"];

export const fitMatters = (job: Pick<JobOverview, "status" | "archivedAt">) =>
  !job.archivedAt && !FIT_SETTLED.includes(job.status);

/** On a single-status tab every pill says the same thing, so it stays quiet. */
export const quietStatus = (tab: JobTab) => tab !== "active" && tab !== "archived";
