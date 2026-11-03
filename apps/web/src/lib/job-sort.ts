import type { JobOverview } from "@copilot/db";
import { FIT_LEVELS, RECOMMENDATIONS } from "@copilot/shared";

export const JOB_SORTS = { latest: "Latest", fit: "Best fit" } as const;
export type JobSort = keyof typeof JOB_SORTS;

/** The `?sort=` value, falling back to latest for anything unknown. */
export function parseJobSort(value: string | string[] | undefined): JobSort {
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
