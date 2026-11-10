import { type DiscoverySource, JOB_STATUSES, type JobStatus } from "@copilot/shared";
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  type SQL,
  sql,
} from "drizzle-orm";
import { type JobOverview, latestAssessmentSql, overviewColumns, toOverview } from "./assessments";
import { getSearchSettings, visibleJobs } from "./discovery";
import type { Db } from "./index";
import { setJobStatus } from "./jobs";
import { currentProfileVersion } from "./profile";
import { jobs, postings } from "./schema";
import { serializeWrites } from "./write-lock";

// The /jobs read model at volume: one page of jobs with tab, filters and order applied in SQL,
// plus the tab counts. The "best fit" order ranks every job on one 0–100 match scale: a full
// assessment's fit level when it has one (against the profile), otherwise the triage score.

export type JobListTab = "active" | "archived" | JobStatus;

export type JobListFilters = {
  /** Only jobs found on this source (discovery). */
  source?: DiscoverySource;
  /** Only jobs whose match score (fit level or triage) reaches this. */
  minScore?: number;
  /** Only jobs posted within this many days (by the listing's posted date). */
  postedWithinDays?: number;
  /** Only discovered matches not opened yet. */
  unseen?: boolean;
};

export type JobListQuery = JobListFilters & {
  tab: JobListTab;
  sort: "latest" | "fit";
  /** Search results (best first): only these, in this order when sorted by latest. */
  ids?: string[];
  limit: number;
  offset: number;
};

/** Fit levels on the triage scale, so assessed and triaged jobs sort together. */
const FIT_SCORE = { strong: 95, good: 80, mixed: 60, weak: 35, poor: 15 } as const;
const VERDICT_RANK = ["pursue", "consider", "investigate_further", "undecided", "pass"];

const fitLevel = sql`json_extract(${latestAssessmentSql}, '$.fitLevel')`;
const fitBasis = sql`json_extract(${latestAssessmentSql}, '$.fitBasis')`;

/** 0–100: a with-profile assessment's fit level, else the triage score, else null. */
export const matchScoreSql = sql<
  number | null
>`(case when ${fitBasis} = 'with_profile' then (case ${fitLevel} ${sql.join(
  Object.entries(FIT_SCORE).map(([level, score]) => sql`when ${level} then ${score}`),
  sql` `,
)} end) else ${jobs.triageScore} end)`;

const verdictRank = sql`(case json_extract(${latestAssessmentSql}, '$.recommendation.verdict') ${sql.join(
  VERDICT_RANK.map((v, i) => sql`when ${v} then ${i}`),
  sql` `,
)} else ${VERDICT_RANK.length} end)`;

const hardConflicts = sql`coalesce(json_array_length(json_extract(${latestAssessmentSql}, '$.hardConflicts')), 0)`;

const postedAt = sql`(select s.posted_at from app_sources s where s.job_id = "app_jobs"."id"
  and s.posted_at is not null and (s.kind != 'web' or s.url = "app_jobs"."canonical_url")
  order by s.retrieved_at desc limit 1)`;

function tabCondition(tab: JobListTab): SQL | undefined {
  if (tab === "archived") return isNotNull(jobs.archivedAt);
  if (tab === "active") return isNull(jobs.archivedAt);
  return and(isNull(jobs.archivedAt), eq(jobs.status, tab));
}

function filterConditions(filters: JobListFilters, now: Date): (SQL | undefined)[] {
  return [
    filters.source
      ? sql`exists (select 1 from app_postings p where p.job_id = "app_jobs"."id" and p.source = ${filters.source})`
      : undefined,
    filters.minScore !== undefined ? gte(matchScoreSql, filters.minScore) : undefined,
    filters.postedWithinDays !== undefined
      ? gte(postedAt, now.getTime() - filters.postedWithinDays * 86_400_000)
      : undefined,
    filters.unseen ? and(eq(jobs.origin, "discovery"), isNull(jobs.seenAt)) : undefined,
  ];
}

/** One page of the job list and how many jobs match in total. */
export async function listJobsPage(
  db: Db,
  query: JobListQuery,
  now: Date = new Date(),
): Promise<{ jobs: JobOverview[]; total: number }> {
  if (query.ids?.length === 0) return { jobs: [], total: 0 };
  const [profileVersion, settings] = await Promise.all([
    currentProfileVersion(db),
    getSearchSettings(db),
  ]);
  const where = and(
    visibleJobs(settings.triageThreshold),
    query.ids ? inArray(jobs.id, query.ids) : undefined,
    tabCondition(query.tab),
    ...filterConditions(query, now),
  );
  const relevance = query.ids
    ? sql`(case ${jobs.id} ${sql.join(
        query.ids.map((id, i) => sql`when ${id} then ${i}`),
        sql` `,
      )} end)`
    : undefined;
  const order =
    query.sort === "fit"
      ? [
          sql`${matchScoreSql} is null`,
          desc(matchScoreSql),
          verdictRank,
          hardConflicts,
          desc(jobs.updatedAt),
        ]
      : relevance
        ? [relevance]
        : [desc(jobs.updatedAt)];
  const [rows, [totals]] = await Promise.all([
    db
      .select(overviewColumns)
      .from(jobs)
      .where(where)
      .orderBy(...order)
      .limit(query.limit)
      .offset(query.offset),
    db.select({ n: count() }).from(jobs).where(where),
  ]);
  return { jobs: rows.map((r) => toOverview(r, profileVersion)), total: totals?.n ?? 0 };
}

/** Jobs per tab for the same search and filters (each tab counted on its own). */
export async function jobTabCounts(
  db: Db,
  query: JobListFilters & { ids?: string[] },
  now: Date = new Date(),
): Promise<Record<JobListTab, number>> {
  const settings = await getSearchSettings(db);
  const empty = Object.fromEntries(
    ["active", "archived", ...JOB_STATUSES].map((t) => [t, 0]),
  ) as Record<JobListTab, number>;
  if (query.ids?.length === 0) return empty;
  const rows = await db
    .select({
      status: jobs.status,
      archived: sql<number>`${jobs.archivedAt} is not null`,
      n: count(),
    })
    .from(jobs)
    .where(
      and(
        visibleJobs(settings.triageThreshold),
        query.ids ? inArray(jobs.id, query.ids) : undefined,
        ...filterConditions(query, now),
      ),
    )
    .groupBy(jobs.status, sql`${jobs.archivedAt} is not null`);
  const counts = { ...empty };
  for (const row of rows) {
    if (row.archived) counts.archived += row.n;
    else {
      counts.active += row.n;
      counts[row.status] += row.n;
    }
  }
  return counts;
}

/** Active assessed jobs, and those assessed against an older profile (Re-score banner). */
export async function assessedJobCounts(db: Db): Promise<{ active: number; stale: number }> {
  const [profileVersion, settings] = await Promise.all([
    currentProfileVersion(db),
    getSearchSettings(db),
  ]);
  const draftProfile = sql<
    number | null
  >`(select d.profile_version from app_job_drafts d where d.job_id = "app_jobs"."id" order by d.version desc limit 1)`;
  const [row] = await db
    .select({
      active: count(),
      stale: sql<number>`coalesce(sum(case when ${draftProfile} != ${profileVersion} then 1 else 0 end), 0)`,
    })
    .from(jobs)
    .where(
      and(
        visibleJobs(settings.triageThreshold),
        isNull(jobs.archivedAt),
        sql`exists (select 1 from app_job_drafts d where d.job_id = "app_jobs"."id")`,
      ),
    );
  return { active: row?.active ?? 0, stale: row?.stale ?? 0 };
}

/** Sets the same pipeline status on many jobs (bulk actions), like `setJobStatus` each. */
export async function setJobsStatus(db: Db, jobIds: string[], status: JobStatus): Promise<number> {
  let changed = 0;
  for (const id of jobIds) {
    const job = await setJobStatus(db, id, status);
    if (job?.status === status) changed += 1;
  }
  return changed;
}

/**
 * Discovered jobs the list hides, still untouched and not kept: scored under the triage
 * threshold, or with every posting now failing the screen (after a settings change). Best score
 * first; `screenReasons` says why the screen fails them. The "Screened out" tab, where the user
 * can keep one anyway.
 */
export async function belowThresholdJobs(
  db: Db,
  input: { limit: number; offset?: number },
): Promise<{ jobs: (JobOverview & { screenReasons: string[] | null })[]; total: number }> {
  const [profileVersion, settings] = await Promise.all([
    currentProfileVersion(db),
    getSearchSettings(db),
  ]);
  // "app_jobs"."id" spelled out: inside select fields Drizzle renders ${jobs.id} unqualified,
  // which the subquery would read as the posting's own id.
  const passing = sql`exists (select 1 from app_postings q where q.job_id = "app_jobs"."id" and q.screen_reasons is null)`;
  const where = and(
    eq(jobs.origin, "discovery"),
    eq(jobs.status, "new"),
    isNull(jobs.archivedAt),
    isNull(jobs.keptAt),
    sql`(not ${passing} or ${jobs.triageScore} < ${settings.triageThreshold})`,
  );
  const [rows, [totals]] = await Promise.all([
    db
      .select({
        ...overviewColumns,
        screenReasons: sql<
          string | null
        >`(case when ${passing} then null else (select p.screen_reasons from app_postings p where p.job_id = "app_jobs"."id" order by p.first_seen_at desc limit 1) end)`,
      })
      .from(jobs)
      .where(where)
      .orderBy(sql`${jobs.triageScore} is null`, desc(jobs.triageScore), desc(jobs.triagedAt))
      .limit(input.limit)
      .offset(input.offset ?? 0),
    db.select({ n: count() }).from(jobs).where(where),
  ]);
  return {
    jobs: rows.map(({ screenReasons, ...r }) => ({
      ...toOverview(r, profileVersion),
      screenReasons: screenReasons ? (JSON.parse(screenReasons) as string[]) : null,
    })),
    total: totals?.n ?? 0,
  };
}

/** Postings the screen dropped (never became jobs), newest first, with their reasons. */
export async function screenedOutPostings(
  db: Db,
  input: { since: Date; limit: number; offset?: number },
) {
  const where = and(
    gte(postings.firstSeenAt, input.since),
    isNotNull(postings.screenReasons),
    isNull(postings.jobId),
  );
  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: postings.id,
        source: postings.source,
        url: postings.url,
        title: postings.title,
        company: postings.company,
        location: postings.location,
        postedAt: postings.postedAt,
        reasons: postings.screenReasons,
      })
      .from(postings)
      .where(where)
      .orderBy(desc(postings.firstSeenAt))
      .limit(input.limit)
      .offset(input.offset ?? 0),
    db.select({ n: count() }).from(postings).where(where),
  ]);
  return { postings: rows, total: totals?.n ?? 0 };
}

/** Visible jobs per company key (the "+N more roles here" hint and company pages). */
export async function companyJobCounts(db: Db, keys: string[]): Promise<Record<string, number>> {
  if (keys.length === 0) return {};
  const settings = await getSearchSettings(db);
  const rows = await db
    .select({ key: jobs.companyKey, n: count() })
    .from(jobs)
    .where(
      and(
        visibleJobs(settings.triageThreshold),
        isNull(jobs.archivedAt),
        inArray(jobs.companyKey, keys),
      ),
    )
    .groupBy(jobs.companyKey);
  return Object.fromEntries(rows.flatMap((r) => (r.key ? [[r.key, r.n]] : [])));
}

/** "Keep anyway" on a hidden job: always shown from now on, whatever the screen or triage say. */
export function keepJob(db: Db, jobId: string): Promise<void> {
  return serializeWrites(db, async () => {
    await db.update(jobs).set({ keptAt: new Date() }).where(eq(jobs.id, jobId));
  });
}

/**
 * Discovered jobs triaged against an older profile, still untouched. `resetStaleTriage` clears
 * their scores so the next run triages them again (they show as "triage pending" meanwhile).
 */
export async function staleTriageCount(db: Db): Promise<number> {
  const version = await currentProfileVersion(db);
  const [row] = await db.select({ n: count() }).from(jobs).where(staleTriage(version));
  return row?.n ?? 0;
}

export function resetStaleTriage(db: Db): Promise<number> {
  return serializeWrites(db, async () => {
    const version = await currentProfileVersion(db);
    const rows = await db
      .update(jobs)
      .set({ triageScore: null, triageReason: null, triageProfileVersion: null, triagedAt: null })
      .where(staleTriage(version))
      .returning({ id: jobs.id });
    return rows.length;
  });
}

const staleTriage = (profileVersion: number) =>
  and(
    eq(jobs.origin, "discovery"),
    eq(jobs.status, "new"),
    isNull(jobs.archivedAt),
    isNotNull(jobs.triageScore),
    sql`coalesce(${jobs.triageProfileVersion}, -1) != ${profileVersion}`,
  );

/**
 * Every job of one company (by company key), newest first, with whether the list hides it
 * (screened out or under the triage threshold) and whether research found anything on it.
 */
export async function companyJobs(
  db: Db,
  key: string,
): Promise<(JobOverview & { hidden: boolean; claimCount: number })[]> {
  const [profileVersion, settings] = await Promise.all([
    currentProfileVersion(db),
    getSearchSettings(db),
  ]);
  const rows = await db
    .select({
      ...overviewColumns,
      visible: sql<number>`${visibleJobs(settings.triageThreshold)}`,
      claimCount: sql<number>`(select count(*) from app_claims c where c.job_id = "app_jobs"."id")`,
    })
    .from(jobs)
    .where(eq(jobs.companyKey, key))
    .orderBy(desc(jobs.updatedAt));
  return rows.map(({ visible, claimCount, ...row }) => ({
    ...toOverview(row, profileVersion),
    hidden: !visible,
    claimCount,
  }));
}
