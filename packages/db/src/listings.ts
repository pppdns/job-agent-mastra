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
 * Jobs worth checking, least recently checked first: shortlisted and to-apply jobs, and new jobs the user
 * would see that came from a chat or scored at least the digest threshold. Archived jobs and
 * jobs the listing check already dismissed once (the user may have restored them) are skipped.
 */
export async function jobsToCheckListings(
  db: Db,
  settings: Pick<SearchSettings, "triageThreshold" | "digestThreshold">,
  limit = 500,
): Promise<JobToCheck[]> {
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
    .where(
      and(
        isNull(jobs.archivedAt),
        isNull(jobs.listingClosedAt),
        or(
          inArray(jobs.status, ["shortlisted", "to_apply"]),
          and(
            eq(jobs.status, "new"),
            visibleJobs(settings.triageThreshold),
            or(
              eq(jobs.origin, "chat"),
              sql`${jobs.triageScore} >= ${Math.max(settings.digestThreshold, settings.triageThreshold)}`,
            ),
          ),
        ),
      ),
    )
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
