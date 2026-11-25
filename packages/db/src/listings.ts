import type { SearchSettings } from "@copilot/shared";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { visibleJobs } from "./discovery";
import type { Db } from "./index";
import { type Job, jobs, type ListingClosed, postings, sources } from "./schema";
import { serializeWrites } from "./write-lock";

// The daily listing check (apps/agent/src/listings): which jobs to look at, their links, and
// dismissing a job whose listing closed. Only `new`, `shortlisted` and `to_apply` jobs are ever dismissed.

/** Statuses the listing check may dismiss: the user hasn't applied yet. */
export const LISTING_CHECK_STATUSES = ["new", "shortlisted", "to_apply"] as const;

export type JobToCheck = {
  id: string;
  status: Job["status"];
  title: string | null;
  company: string | null;
  /** Every listing link of the job: canonical URL, LinkedIn, ATS snapshots, board postings. */
  urls: string[];
};

/**
 * The groups of jobs a listing check can cover; disjoint, so their counts add up. The daily run
 * checks `DAILY_LISTING_SCOPES`; /discovery lets the user pick any.
 * - `shortlisted`, `to_apply`: jobs in that status
 * - `top_new`: new jobs the user would see that came from a chat or scored at least the digest threshold
 * - `other_new`: the other new jobs the user would see
 */
export const LISTING_SCOPES = ["shortlisted", "to_apply", "top_new", "other_new"] as const;
export type ListingScope = (typeof LISTING_SCOPES)[number];
export const DAILY_LISTING_SCOPES: readonly ListingScope[] = ["shortlisted", "to_apply", "top_new"];

type ScopeSettings = Pick<SearchSettings, "triageThreshold" | "digestThreshold">;

/** New jobs from a chat or scored at least the digest threshold (never below the triage one). */
const topNew = (settings: ScopeSettings) =>
  or(
    eq(jobs.origin, "chat"),
    sql`coalesce(${jobs.triageScore}, -1) >= ${Math.max(settings.digestThreshold, settings.triageThreshold)}`,
  );

function scopeCondition(scope: ListingScope, settings: ScopeSettings) {
  switch (scope) {
    case "shortlisted":
    case "to_apply":
      return eq(jobs.status, scope);
    case "top_new":
      return and(eq(jobs.status, "new"), visibleJobs(settings.triageThreshold), topNew(settings));
    case "other_new":
      return and(
        eq(jobs.status, "new"),
        visibleJobs(settings.triageThreshold),
        sql`NOT ${topNew(settings)}`,
      );
  }
}

/** Never checked: archived jobs and jobs the listing check already dismissed once (the user may have restored them). */
const checkable = and(isNull(jobs.archivedAt), isNull(jobs.listingClosedAt));

/** How many jobs each scope covers right now (before the run's limit). */
export async function countListingScopes(
  db: Db,
  settings: ScopeSettings,
): Promise<Record<ListingScope, number>> {
  const counts = await Promise.all(
    LISTING_SCOPES.map(async (scope) => {
      const [row] = await db
        .select({ n: sql<number>`count(*)` })
        .from(jobs)
        .where(and(checkable, scopeCondition(scope, settings)));
      return [scope, Number(row?.n ?? 0)] as const;
    }),
  );
  return Object.fromEntries(counts) as Record<ListingScope, number>;
}

/**
 * Jobs worth checking in the given scopes, least recently checked first. Archived jobs and jobs
 * the listing check already dismissed once are skipped.
 */
export async function jobsToCheckListings(
  db: Db,
  settings: ScopeSettings,
  limit = 500,
  scopes: readonly ListingScope[] = DAILY_LISTING_SCOPES,
): Promise<JobToCheck[]> {
  if (scopes.length === 0) return [];
  const rows = await db
    .select({
      id: jobs.id,
      status: jobs.status,
      title: jobs.title,
      company: jobs.company,
      canonicalUrl: jobs.canonicalUrl,
      linkedinJobId: jobs.linkedinJobId,
    })
    .from(jobs)
    .where(and(checkable, or(...scopes.map((scope) => scopeCondition(scope, settings)))))
    .orderBy(sql`${jobs.listingCheckedAt} IS NOT NULL`, asc(jobs.listingCheckedAt), asc(jobs.id))
    .limit(limit);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [listingSources, boardPostings] = await Promise.all([
    db
      .select({ jobId: sources.jobId, url: sources.url })
      .from(sources)
      .where(and(inArray(sources.jobId, ids), inArray(sources.kind, ["linkedin", "ats"]))),
    db
      .select({ jobId: postings.jobId, url: postings.url, applyUrl: postings.applyUrl })
      .from(postings)
      .where(inArray(postings.jobId, ids)),
  ]);
  const extra = new Map<string, (string | null)[]>();
  const add = (jobId: string | null, ...urls: (string | null)[]) => {
    if (jobId) extra.set(jobId, [...(extra.get(jobId) ?? []), ...urls]);
  };
  for (const s of listingSources) add(s.jobId, s.url);
  for (const p of boardPostings) add(p.jobId, p.applyUrl, p.url);

  return rows.map((r) => {
    const all = [
      r.canonicalUrl,
      r.linkedinJobId ? `https://www.linkedin.com/jobs/view/${r.linkedinJobId}/` : null,
      ...(extra.get(r.id) ?? []),
    ];
    return {
      id: r.id,
      status: r.status,
      title: r.title,
      company: r.company,
      urls: [...new Set(all.filter((u): u is string => Boolean(u)))],
    };
  });
}

/** Records that these jobs' links were checked (open or unknown alike). */
export function markListingsChecked(db: Db, jobIds: string[], at = new Date()): Promise<void> {
  if (jobIds.length === 0) return Promise.resolve();
  return serializeWrites(db, async () => {
    await db.update(jobs).set({ listingCheckedAt: at }).where(inArray(jobs.id, jobIds));
  });
}

/**
 * Dismisses (and archives) a job whose listing closed, recording why. Only while the job is
 * still `new`, `shortlisted` or `to_apply`: a status the user changed in the meantime wins. Returns the
 * updated job, or undefined when nothing changed.
 */
export function dismissClosedListing(
  db: Db,
  jobId: string,
  evidence: Omit<ListingClosed, "previousStatus">,
  at = new Date(),
): Promise<Job | undefined> {
  return serializeWrites(db, async () => {
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!job || !(LISTING_CHECK_STATUSES as readonly string[]).includes(job.status)) {
      return undefined;
    }
    const [updated] = await db
      .update(jobs)
      .set({
        status: "dismissed",
        statusChangedAt: at,
        // A status change, like setJobStatus: the pipeline's "in stage" age restarts.
        progressedAt: at,
        archivedAt: job.archivedAt ?? at,
        listingCheckedAt: at,
        listingClosedAt: at,
        listingClosed: { ...evidence, previousStatus: job.status },
      })
      .where(and(eq(jobs.id, jobId), inArray(jobs.status, [...LISTING_CHECK_STATUSES])))
      .returning();
    return updated;
  });
}
