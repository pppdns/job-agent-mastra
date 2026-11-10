import { DISCOVERY_SOURCES, type DiscoverySource, JOB_STATUS_LABELS } from "@copilot/shared";

// URL state of /jobs: tab, search, sort, discovery filters and page. Filtering, ordering and
// counting happen in SQL (`listJobsPage`, `jobTabCounts` in @copilot/db).

export const JOB_SORTS = { latest: "Latest", fit: "Best fit" } as const;
export type JobSort = keyof typeof JOB_SORTS;

/** Rows per page. */
export const JOBS_PAGE_SIZE = 50;

/** Status tabs on /jobs: active = everything not archived; screened = what discovery hid. */
export const JOB_TABS = [
  "active",
  "new",
  "shortlisted",
  "applied",
  "interviewing",
  "offer",
  "archived",
  "screened",
] as const;
export type JobTab = (typeof JOB_TABS)[number];

export const JOB_TAB_LABELS: Record<JobTab, string> = {
  active: "Active",
  archived: "Archived",
  screened: "Screened out",
  ...JOB_STATUS_LABELS,
};

/** The New tab is the inbox of discovered matches: best first. Everything else: latest first. */
export const defaultSort = (tab: JobTab): JobSort => (tab === "new" ? "fit" : "latest");

export const MIN_SCORE_OPTIONS = [60, 75, 90] as const;
export const POSTED_WITHIN_OPTIONS = [1, 7, 30] as const;

export type JobListParams = {
  tab: JobTab;
  q: string;
  sort: JobSort;
  source?: DiscoverySource;
  minScore?: number;
  postedWithinDays?: number;
  unseen: boolean;
  /** 1-based. */
  page: number;
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const oneOf = <T extends number>(options: readonly T[], value: string | undefined) =>
  options.find((o) => String(o) === value);

/** `?tab=&q=&sort=&source=&min=&posted=&unseen=&page=` with safe fallbacks. */
export function parseJobListParams(
  params: Record<string, string | string[] | undefined>,
): JobListParams {
  const tab = JOB_TABS.find((t) => t === first(params.tab)) ?? "active";
  const sort = first(params.sort);
  const page = Number.parseInt(first(params.page) ?? "1", 10);
  return {
    tab,
    q: (first(params.q) ?? "").trim().slice(0, 200),
    sort: sort === "fit" || sort === "latest" ? sort : defaultSort(tab),
    source: DISCOVERY_SOURCES.find((s) => s === first(params.source)),
    minScore: oneOf(MIN_SCORE_OPTIONS, first(params.min)),
    postedWithinDays: oneOf(POSTED_WITHIN_OPTIONS, first(params.posted)),
    unseen: first(params.unseen) === "1",
    page: Number.isFinite(page) && page > 1 ? Math.min(page, 1_000) : 1,
  };
}

/** The /jobs URL for these params, leaving out defaults. */
export function jobListHref(params: JobListParams): string {
  const search = new URLSearchParams();
  if (params.tab !== "active") search.set("tab", params.tab);
  if (params.q) search.set("q", params.q);
  if (params.sort !== defaultSort(params.tab)) search.set("sort", params.sort);
  if (params.source) search.set("source", params.source);
  if (params.minScore) search.set("min", String(params.minScore));
  if (params.postedWithinDays) search.set("posted", String(params.postedWithinDays));
  if (params.unseen) search.set("unseen", "1");
  if (params.page > 1) search.set("page", String(params.page));
  const query = search.toString();
  return query ? `/jobs?${query}` : "/jobs";
}

/** Same list with another tab, sort or filter: back to page 1 (and the tab's default sort). */
export function withParams(params: JobListParams, change: Partial<JobListParams>): string {
  const tabChanged = change.tab !== undefined && change.tab !== params.tab;
  return jobListHref({
    ...params,
    ...(tabChanged ? { sort: defaultSort(change.tab as JobTab) } : {}),
    page: 1,
    ...change,
  });
}

/** Whether any discovery filter is on. */
export const hasFilters = (p: JobListParams) =>
  Boolean(p.source || p.minScore || p.postedWithinDays || p.unseen);
