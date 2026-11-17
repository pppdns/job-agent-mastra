import {
  type Db,
  dismissClosedListing,
  getSearchSettings,
  type JobToCheck,
  jobsToCheckListings,
  markListingsChecked,
} from "@copilot/db";
import {
  checkListing,
  type ListingCheck,
  type ListingProbe,
  type ListingSite,
  type ProbeFetch,
  planProbe,
  probeFetch,
} from "./checkers";

// One listing check: every job in scope, each of its links with a verified rule, one request at
// a time with a pause per site. The first confidently closed link dismisses the job (only
// while it is still new or shortlisted); unknown answers change nothing.

/** Pause between two requests to the same site (LinkedIn rate-limits a fast guest client). */
const SITE_GAP_MS: Partial<Record<ListingSite, number>> = { linkedin: 1_500 };
const DEFAULT_GAP_MS = 500;

export type ClosedJob = {
  id: string;
  title: string | null;
  company: string | null;
  previousStatus: string;
  url: string;
  site: ListingSite;
  signal: string;
};

export type ListingCheckResult = {
  jobs: number;
  /** Requests made. */
  checks: number;
  open: number;
  unknown: number;
  /** Links without a verified rule (Himalayas, WeWorkRemotely, company sites, …). */
  unsupported: number;
  /** Jobs dismissed (or, in a dry run, that would be). */
  closed: ClosedJob[];
  /** Sites skipped for the rest of the run after a rate limit. */
  rateLimited: ListingSite[];
  unknownSignals: Record<string, number>;
};

export type ListingCheckOptions = {
  fetchProbe?: ProbeFetch;
  wait?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  /** Report only: dismiss nothing and don't record the check. */
  dryRun?: boolean;
  limit?: number;
  now?: () => Date;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Checks the listings of the jobs in scope and dismisses the closed ones. */
export async function runListingCheck(
  db: Db,
  options: ListingCheckOptions = {},
): Promise<ListingCheckResult> {
  const { fetchProbe = probeFetch, wait = sleep, signal, dryRun = false } = options;
  const now = options.now ?? (() => new Date());
  const settings = await getSearchSettings(db);
  const jobs = await jobsToCheckListings(db, settings, options.limit);

  const result: ListingCheckResult = {
    jobs: jobs.length,
    checks: 0,
    open: 0,
    unknown: 0,
    unsupported: 0,
    closed: [],
    rateLimited: [],
    unknownSignals: {},
  };
  const lastRequest = new Map<ListingSite, number>();
  const blocked = new Set<ListingSite>();

  const check = async (probe: ListingProbe): Promise<ListingCheck | null> => {
    if (blocked.has(probe.site)) return null;
    const gap = SITE_GAP_MS[probe.site] ?? DEFAULT_GAP_MS;
    const last = lastRequest.get(probe.site);
    if (last !== undefined) {
      const due = last + gap - Date.now();
      if (due > 0) await wait(due);
    }
    lastRequest.set(probe.site, Date.now());
    const outcome = await checkListing(probe, fetchProbe, signal);
    result.checks += 1;
    if (outcome.status === 429) {
      blocked.add(probe.site);
      result.rateLimited.push(probe.site);
    }
    return outcome;
  };

  const checked: string[] = [];
  for (const job of jobs) {
    signal?.throwIfAborted();
    const closed = await checkJob(job, check, result);
    checked.push(job.id);
    if (!closed) continue;
    if (dryRun) {
      result.closed.push({ ...closed, previousStatus: job.status });
      continue;
    }
    const dismissed = await dismissClosedListing(
      db,
      job.id,
      { url: closed.url, site: closed.site, signal: closed.signal },
      now(),
    );
    if (dismissed) result.closed.push({ ...closed, previousStatus: job.status });
  }
  if (!dryRun) await markListingsChecked(db, checked, now());
  return result;
}

/** Checks a job's links in order and returns the first closed one, if any. */
async function checkJob(
  job: JobToCheck,
  check: (probe: ListingProbe) => Promise<ListingCheck | null>,
  result: ListingCheckResult,
): Promise<Omit<ClosedJob, "previousStatus"> | null> {
  const probes = new Map<string, ListingProbe>();
  for (const url of job.urls) {
    const probe = planProbe(url);
    if (!probe) result.unsupported += 1;
    else if (!probes.has(probe.fetchUrl)) probes.set(probe.fetchUrl, probe);
  }
  for (const probe of probes.values()) {
    const outcome = await check(probe);
    if (!outcome || outcome.verdict === "unknown") {
      result.unknown += 1;
      const key = outcome ? `${outcome.site}: ${outcome.signal}` : `${probe.site}: rate limited`;
      result.unknownSignals[key] = (result.unknownSignals[key] ?? 0) + 1;
      continue;
    }
    if (outcome.verdict === "open") {
      result.open += 1;
      continue;
    }
    return {
      id: job.id,
      title: job.title,
      company: job.company,
      url: outcome.url,
      site: outcome.site,
      signal: outcome.signal,
    };
  }
  return null;
}
