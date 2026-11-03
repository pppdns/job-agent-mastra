import type { JobOverview } from "@copilot/db";
import { FIT_LEVELS, JOB_STATUS_LABELS, RECOMMENDATIONS } from "@copilot/shared";

export const JOB_SORTS = { latest: "Latest", fit: "Best fit" } as const;
export type JobSort = keyof typeof JOB_SORTS;

/** The `?sort=` value, falling back to latest for anything unknown. */
export function parseJobSort(value: string | undefined): JobSort {
  return value === "fit" ? "fit" : "latest";
}

/** Rank of a list value, with missing values last. */
const rank = <T>(list: readonly T[], value: T | undefined) =>
  value === undefined ? list.length : list.indexOf(value);

/**
 * Jobs in the chosen order. `jobs` arrive newest first, so latest keeps them as they are.
 * Best fit: fit level, then verdict, then fewer hard conflicts; unassessed and role-only
 * jobs go last. The sort is stable, so ties stay newest first.
 */
export function sortJobs(jobs: JobOverview[], sort: JobSort): JobOverview[] {
  if (sort === "latest") return jobs;
  return jobs.toSorted((a, b) => {
    const [x, y] = [a.summary, b.summary];
    return (
      rank(FIT_LEVELS, x?.fitLevel) - rank(FIT_LEVELS, y?.fitLevel) ||
      rank(RECOMMENDATIONS, x?.verdict) - rank(RECOMMENDATIONS, y?.verdict) ||
      (x?.counts.hardConflicts ?? 0) - (y?.counts.hardConflicts ?? 0)
    );
  });
}

/** Status tabs on /jobs: active = everything not archived. */
export const JOB_TABS = [
  "active",
  "new",
  "shortlisted",
  "applied",
  "interviewing",
  "offer",
  "archived",
] as const;
export type JobTab = (typeof JOB_TABS)[number];

export const JOB_TAB_LABELS: Record<JobTab, string> = {
  active: "Active",
  archived: "Archived",
  ...JOB_STATUS_LABELS,
};

export type JobListParams = { tab: JobTab; q: string; sort: JobSort };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** `?tab=&q=&sort=` with safe fallbacks (active, no search, latest). */
export function parseJobListParams(
  params: Record<string, string | string[] | undefined>,
): JobListParams {
  const tab = first(params.tab);
  return {
    tab: JOB_TABS.find((t) => t === tab) ?? "active",
    q: (first(params.q) ?? "").trim().slice(0, 200),
    sort: parseJobSort(first(params.sort)),
  };
}

/** The /jobs URL for these params, leaving out defaults. */
export function jobListHref({ tab, q, sort }: JobListParams): string {
  const search = new URLSearchParams();
  if (tab !== "active") search.set("tab", tab);
  if (q) search.set("q", q);
  if (sort !== "latest") search.set("sort", sort);
  const query = search.toString();
  return query ? `/jobs?${query}` : "/jobs";
}

/** Whether a job belongs on a tab. Status tabs show only jobs that aren't archived. */
export function inTab(job: Pick<JobOverview, "status" | "archivedAt">, tab: JobTab): boolean {
  if (tab === "archived") return job.archivedAt !== null;
  if (job.archivedAt !== null) return false;
  return tab === "active" || job.status === tab;
}

/** Number of jobs on each tab. */
export function tabCounts(jobs: Pick<JobOverview, "status" | "archivedAt">[]) {
  return Object.fromEntries(
    JOB_TABS.map((tab) => [tab, jobs.filter((j) => inTab(j, tab)).length]),
  ) as Record<JobTab, number>;
}
