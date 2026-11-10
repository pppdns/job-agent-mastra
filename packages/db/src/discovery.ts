import { randomUUID } from "node:crypto";
import {
  companyKey,
  DISCOVERY_SOURCE_LABELS,
  type DiscoverySource,
  type PostingInput,
  parseSearchSettings,
  postingSnapshot,
  type ScreenResult,
  type SearchSettings,
} from "@copilot/shared";
import { and, desc, eq, gte, inArray, isNotNull, isNull, notExists, sql } from "drizzle-orm";
import type { Db } from "./index";
import { addSourceUnlocked, upsertJobUnlocked } from "./jobs";
import {
  type DiscoveryRun,
  type DiscoveryRunStatus,
  type DiscoveryTrigger,
  discoveryRuns,
  type FunnelResult,
  jobDrafts,
  jobs,
  type Posting,
  postings,
  type SourceRunResult,
  searchSettings,
} from "./schema";
import { canonicalWebUrl } from "./url";
import { serializeWrites } from "./write-lock";

// Discovery: search settings, runs and postings. Postings that fail the screen never become jobs;
// passing ones are deduped into `app_jobs` (company key + title, or a shared off-board apply URL)
// with a `board` snapshot the assessment rules can cite.

const SETTINGS_ROW = 1;

export async function getSearchSettings(db: Db): Promise<SearchSettings> {
  const row = await db.query.searchSettings.findFirst({
    where: eq(searchSettings.id, SETTINGS_ROW),
  });
  return parseSearchSettings(row?.settings);
}

export function saveSearchSettings(db: Db, settings: SearchSettings): Promise<void> {
  return serializeWrites(db, async () => {
    const now = new Date();
    await db
      .insert(searchSettings)
      .values({ id: SETTINGS_ROW, settings, updatedAt: now })
      .onConflictDoUpdate({ target: searchSettings.id, set: { settings, updatedAt: now } });
  });
}

/**
 * Starts a discovery run, or returns null while another one is still running (one at a time:
 * runs share the Apify budget and the job table).
 */
export function startDiscoveryRun(
  db: Db,
  input: { trigger: DiscoveryTrigger; lookbackDays?: number | null; workflowRunId?: string },
): Promise<DiscoveryRun | null> {
  return serializeWrites(db, async () => {
    const running = await db.query.discoveryRuns.findFirst({
      where: eq(discoveryRuns.status, "running"),
    });
    if (running) return null;
    const [row] = await db
      .insert(discoveryRuns)
      .values({
        id: randomUUID(),
        trigger: input.trigger,
        status: "running",
        lookbackDays: input.lookbackDays ?? null,
        sources: [],
        workflowRunId: input.workflowRunId ?? null,
        startedAt: new Date(),
      })
      .returning();
    if (!row) throw new Error("discovery run insert returned no row");
    return row;
  });
}

/** Saves a source's result on a running run as soon as it is known (partial runs keep them). */
export function recordSourceResult(db: Db, runId: string, result: SourceRunResult): Promise<void> {
  return serializeWrites(db, async () => {
    const run = await db.query.discoveryRuns.findFirst({ where: eq(discoveryRuns.id, runId) });
    if (!run) return;
    const sources = [...run.sources.filter((s) => s.source !== result.source), result];
    await db
      .update(discoveryRuns)
      .set({ sources, estimatedUsd: runCost(sources, run.funnel) })
      .where(eq(discoveryRuns.id, runId));
  });
}

/** Provider cost of every source plus the model cost of the funnel. */
const runCost = (sources: SourceRunResult[], funnel: FunnelResult | null) =>
  sources.reduce((sum, s) => sum + s.costUsd, 0) + (funnel?.llmUsd ?? 0);

/** Saves what the run did after fetching (replaces the previous funnel record). */
export function recordFunnel(db: Db, runId: string, funnel: FunnelResult): Promise<void> {
  return serializeWrites(db, async () => {
    const run = await db.query.discoveryRuns.findFirst({ where: eq(discoveryRuns.id, runId) });
    if (!run) return;
    await db
      .update(discoveryRuns)
      .set({ funnel, estimatedUsd: runCost(run.sources, funnel) })
      .where(eq(discoveryRuns.id, runId));
  });
}

/** Ends a running run; a run that already ended keeps its first final status. */
export function finishDiscoveryRun(
  db: Db,
  runId: string,
  status: Exclude<DiscoveryRunStatus, "running">,
  error?: string,
): Promise<void> {
  return serializeWrites(db, async () => {
    await db
      .update(discoveryRuns)
      .set({ status, error: error?.slice(0, 500) ?? null, endedAt: new Date() })
      .where(and(eq(discoveryRuns.id, runId), eq(discoveryRuns.status, "running")));
  });
}

/** Runs left "running" by a previous process: mark them interrupted at startup. */
export function interruptStaleDiscoveryRuns(db: Db): Promise<number> {
  return serializeWrites(db, async () => {
    const rows = await db
      .update(discoveryRuns)
      .set({ status: "interrupted", endedAt: new Date() })
      .where(eq(discoveryRuns.status, "running"))
      .returning({ id: discoveryRuns.id });
    return rows.length;
  });
}

export async function listDiscoveryRuns(db: Db, limit = 30): Promise<DiscoveryRun[]> {
  return db.query.discoveryRuns.findMany({ orderBy: desc(discoveryRuns.startedAt), limit });
}

/** Runs started since a date, newest first (e.g. the alert throttle's 24 hours). */
export async function discoveryRunsSince(db: Db, since: Date): Promise<DiscoveryRun[]> {
  return db.query.discoveryRuns.findMany({
    where: gte(discoveryRuns.startedAt, since),
    orderBy: desc(discoveryRuns.startedAt),
  });
}

export async function getDiscoveryRun(db: Db, runId: string): Promise<DiscoveryRun | undefined> {
  return db.query.discoveryRuns.findFirst({ where: eq(discoveryRuns.id, runId) });
}

export type SourceState = {
  source: DiscoverySource;
  /** End of the last run where this source fully succeeded (the next run asks from here). */
  lastOkAt: Date | null;
  last: SourceRunResult | null;
  /** Last run failed, or the last two runs returned nothing. */
  unhealthy: boolean;
};

/** Per-source cursor and health, derived from recent runs (newest first). */
export function sourceStates(runs: DiscoveryRun[], sources: readonly DiscoverySource[]) {
  return sources.map((source): SourceState => {
    const results = runs.flatMap((run) => {
      const result = run.sources.find((s) => s.source === source);
      return result && result.status !== "skipped" ? [{ run, result }] : [];
    });
    // Only a fully good run moves the cursor: after a partial one (a search failed), the next
    // run asks again from the last good run, so the failed part's window isn't lost. Known
    // postings are skipped (and not billed by paid sources), so asking again is cheap.
    const lastOk = results.find((r) => r.result.status === "ok");
    const last = results[0]?.result ?? null;
    const lastTwo = results.slice(0, 2);
    const empty = lastTwo.length === 2 && lastTwo.every((r) => r.result.fetched === 0);
    return {
      source,
      lastOkAt: lastOk ? (lastOk.run.endedAt ?? lastOk.run.startedAt) : null,
      last,
      unhealthy: last?.status === "failed" || empty,
    };
  });
}

/** Provider spend of the given sources since a date (USD, as the runs recorded it). */
export async function sourceSpendSince(
  db: Db,
  sources: readonly DiscoverySource[],
  since: Date,
): Promise<number> {
  const runs = await db.query.discoveryRuns.findMany({
    where: gte(discoveryRuns.startedAt, since),
  });
  return runs
    .flatMap((r) => r.sources)
    .filter((s) => sources.includes(s.source))
    .reduce((sum, s) => sum + s.costUsd, 0);
}

/** What one source brought in over a window, to judge whether it's worth keeping. */
export type SourceStats = {
  source: DiscoverySource;
  /** Postings first seen in the window. */
  postings: number;
  /** Of those, how many passed the screen. */
  passed: number;
  /** Jobs these postings belong to. */
  jobs: number;
  /** Jobs also found on another board (overlap). */
  duplicates: number;
  /** Jobs that are matches: triage at or above the threshold, kept, or acted on. */
  matches: number;
  /** Matches no other board found. */
  uniqueMatches: number;
  /** Provider spend in the window (USD, as runs recorded it). */
  costUsd: number;
};

/** Per-source yield since a date: postings, screen passes, overlap, matches and cost. */
export async function sourceStatsSince(
  db: Db,
  sources: readonly DiscoverySource[],
  since: Date,
  triageThreshold: number,
): Promise<SourceStats[]> {
  const elsewhere = sql`EXISTS (SELECT 1 FROM app_postings o WHERE o.job_id = p.job_id AND o.source != p.source)`;
  const match = sql`(j.kept_at IS NOT NULL OR j.status NOT IN ('new', 'dismissed') OR j.triage_score >= ${triageThreshold})`;
  const rows = await db.all<{
    source: DiscoverySource;
    postings: number;
    passed: number;
    jobs: number;
    duplicates: number;
    matches: number;
    unique_matches: number;
  }>(sql`
    SELECT p.source AS source,
      COUNT(*) AS postings,
      SUM(CASE WHEN p.screen_reasons IS NULL THEN 1 ELSE 0 END) AS passed,
      COUNT(DISTINCT p.job_id) AS jobs,
      COUNT(DISTINCT CASE WHEN ${elsewhere} THEN p.job_id END) AS duplicates,
      COUNT(DISTINCT CASE WHEN ${match} THEN p.job_id END) AS matches,
      COUNT(DISTINCT CASE WHEN ${match} AND NOT ${elsewhere} THEN p.job_id END) AS unique_matches
    FROM app_postings p LEFT JOIN app_jobs j ON j.id = p.job_id
    WHERE p.first_seen_at >= ${since.getTime()}
    GROUP BY p.source`);
  const runs = await db.query.discoveryRuns.findMany({
    where: gte(discoveryRuns.startedAt, since),
  });
  const spend = (source: DiscoverySource) =>
    runs
      .flatMap((r) => r.sources)
      .filter((s) => s.source === source)
      .reduce((sum, s) => sum + s.costUsd, 0);
  return sources.map((source) => {
    const row = rows.find((r) => r.source === source);
    return {
      source,
      postings: Number(row?.postings ?? 0),
      passed: Number(row?.passed ?? 0),
      jobs: Number(row?.jobs ?? 0),
      duplicates: Number(row?.duplicates ?? 0),
      matches: Number(row?.matches ?? 0),
      uniqueMatches: Number(row?.unique_matches ?? 0),
      costUsd: spend(source),
    };
  });
}

/** Board ids already stored for a source (e.g. so a paid scraper can skip them). */
export async function knownExternalIds(
  db: Db,
  source: DiscoverySource,
  since: Date,
  limit = 3_000,
): Promise<string[]> {
  const rows = await db
    .select({ id: postings.externalId })
    .from(postings)
    .where(and(eq(postings.source, source), gte(postings.lastSeenAt, since)))
    .orderBy(desc(postings.lastSeenAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

export type PostingOutcome = "seen" | "filtered" | "new_job" | "merged";

/** Hosts of the boards themselves: their URLs never identify a job across boards. */
const BOARD_HOSTS = ["himalayas.app", "linkedin.com"];

/** The apply URL when it leads off the board (ATS or company site), canonicalized. */
function offBoardUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (BOARD_HOSTS.some((b) => host === b || host.endsWith(`.${b}`))) return null;
    return canonicalWebUrl(parsed);
  } catch {
    return null;
  }
}

/**
 * Stores one posting from a run. A posting seen before only gets `last_seen_at` bumped (its job
 * row is untouched, so list order stays stable). A new one is screened: failing postings stay
 * postings; passing ones are deduped into a job with a board snapshot.
 */
export function recordPosting(
  db: Db,
  input: { posting: PostingInput; screen: ScreenResult; runId: string; now?: Date },
): Promise<PostingOutcome> {
  return serializeWrites(db, async () => {
    const { posting, screen } = input;
    const now = input.now ?? new Date();
    const existing = await db.query.postings.findFirst({
      where: and(eq(postings.source, posting.source), eq(postings.externalId, posting.externalId)),
    });
    if (existing) {
      await db.update(postings).set({ lastSeenAt: now }).where(eq(postings.id, existing.id));
      return "seen";
    }
    const [row] = await db
      .insert(postings)
      .values({
        id: randomUUID(),
        source: posting.source,
        externalId: posting.externalId,
        url: posting.url,
        applyUrl: posting.applyUrl,
        title: posting.title,
        company: posting.company,
        companyKey: companyKey(posting.company),
        location: posting.location,
        remote: posting.remote,
        regions: posting.regions,
        salaryMin: posting.salaryMin,
        salaryMax: posting.salaryMax,
        salaryCurrency: posting.salaryCurrency,
        salaryPeriod: posting.salaryPeriod,
        salaryText: posting.salaryText,
        seniority: posting.seniority,
        employmentType: posting.employmentType,
        postedAt: posting.postedAt,
        description: posting.description,
        screenReasons: screen.pass ? null : screen.reasons,
        firstRunId: input.runId,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .returning();
    if (!row) throw new Error("posting insert returned no row");
    if (!screen.pass) return "filtered";
    const created = await promote(db, row, now);
    return created ? "new_job" : "merged";
  });
}

/** Turns a passing posting into (or merges it with) a job. Caller holds the write lock. */
async function promote(db: Db, row: Posting, now: Date): Promise<boolean> {
  const { job, created } = await upsertJobUnlocked(
    db,
    {
      company: row.company,
      title: row.title,
      location: row.location,
      canonicalUrl: offBoardUrl(row.applyUrl),
      origin: "discovery",
    },
    { touch: false },
  );
  await addSourceUnlocked(db, {
    jobId: job.id,
    kind: "board",
    provider: row.source,
    url: row.url,
    content: postingSnapshot(postingInputOf(row), DISCOVERY_SOURCE_LABELS[row.source]),
    retrievedAt: now,
  });
  await db.update(postings).set({ jobId: job.id }).where(eq(postings.id, row.id));
  return created;
}

const postingInputOf = (row: Posting): PostingInput => ({ ...row });

/**
 * "Keep anyway" on a posting the screen dropped: it becomes a job (deduped like any passing
 * posting) that stays visible whatever the screen or triage say. Returns the job id.
 */
export function keepPosting(db: Db, postingId: string): Promise<string | null> {
  return serializeWrites(db, async () => {
    const row = await db.query.postings.findFirst({ where: eq(postings.id, postingId) });
    if (!row) return null;
    if (!row.jobId) await promote(db, row, new Date());
    const promoted = await db.query.postings.findFirst({ where: eq(postings.id, postingId) });
    if (!promoted?.jobId) return null;
    await db.update(jobs).set({ keptAt: new Date() }).where(eq(jobs.id, promoted.jobId));
    return promoted.jobId;
  });
}

export type RescreenResult = { checked: number; promoted: number; hidden: number; shown: number };

/** When and how a posting arrived: age is judged as of then, with its run's backfill window. */
export type PostingIntake = { seenAt: Date; lookbackDays: number | null };

/**
 * Re-applies the screen to postings first seen since `since` (after a settings change). Newly
 * passing postings become jobs; a discovered job the user hasn't acted on is hidden while all of
 * its postings fail (see `visibleJobs`), and shown again once one passes.
 */
export function rescreenPostings(
  db: Db,
  screen: (posting: PostingInput, intake: PostingIntake) => ScreenResult,
  since: Date,
): Promise<RescreenResult> {
  return serializeWrites(db, async () => {
    const rows = await db.query.postings.findMany({ where: gte(postings.firstSeenAt, since) });
    const runIds = [...new Set(rows.flatMap((r) => (r.firstRunId ? [r.firstRunId] : [])))];
    const runs =
      runIds.length > 0
        ? await db
            .select({ id: discoveryRuns.id, lookbackDays: discoveryRuns.lookbackDays })
            .from(discoveryRuns)
            .where(inArray(discoveryRuns.id, runIds))
        : [];
    const lookback = new Map(runs.map((r) => [r.id, r.lookbackDays]));
    const result: RescreenResult = { checked: rows.length, promoted: 0, hidden: 0, shown: 0 };
    const now = new Date();
    for (const row of rows) {
      const { pass, reasons } = screen(postingInputOf(row), {
        seenAt: row.firstSeenAt,
        lookbackDays: (row.firstRunId && lookback.get(row.firstRunId)) || null,
      });
      const wasPassing = row.screenReasons === null;
      const next = pass ? null : reasons;
      if (JSON.stringify(next) !== JSON.stringify(row.screenReasons)) {
        await db.update(postings).set({ screenReasons: next }).where(eq(postings.id, row.id));
        if (row.jobId && wasPassing && !pass) result.hidden += 1;
        if (row.jobId && !wasPassing && pass) result.shown += 1;
      }
      if (pass && !row.jobId) {
        await promote(db, row, now);
        result.promoted += 1;
      }
    }
    return result;
  });
}

/**
 * Jobs worth showing: chat jobs and jobs the user acted on or kept always; a discovered job
 * still `new` only while one of its postings passes the screen and its triage score (once it
 * has one) reaches the threshold.
 */
export const visibleJobs = (triageThreshold: number) => sql`(
  ${jobs.origin} = 'chat' OR ${jobs.keptAt} IS NOT NULL OR ${jobs.status} != 'new' OR (
    EXISTS (SELECT 1 FROM app_postings p WHERE p.job_id = "app_jobs"."id" AND p.screen_reasons IS NULL)
    AND (${jobs.triageScore} IS NULL OR ${jobs.triageScore} >= ${triageThreshold})
  )
)`;

/** Postings of a job, newest first ("seen on"). */
export async function jobPostings(db: Db, jobId: string): Promise<Posting[]> {
  return db.query.postings.findMany({
    where: eq(postings.jobId, jobId),
    orderBy: desc(postings.firstSeenAt),
  });
}

/** Sources each job was found on (for list badges). */
export async function postingSourcesByJob(
  db: Db,
  jobIds: string[],
): Promise<Record<string, DiscoverySource[]>> {
  if (jobIds.length === 0) return {};
  const rows = await db
    .selectDistinct({ jobId: postings.jobId, source: postings.source })
    .from(postings)
    .where(inArray(postings.jobId, jobIds));
  const bySource: Record<string, DiscoverySource[]> = {};
  for (const row of rows) {
    if (row.jobId) bySource[row.jobId] = [...(bySource[row.jobId] ?? []), row.source];
  }
  return bySource;
}

/** Counts of postings that failed the screen, per reason prefix, since a date (for tuning). */
export async function screenedOutSince(db: Db, since: Date) {
  return db
    .select({
      id: postings.id,
      title: postings.title,
      company: postings.company,
      reasons: postings.screenReasons,
    })
    .from(postings)
    .where(
      and(
        gte(postings.firstSeenAt, since),
        sql`${postings.screenReasons} IS NOT NULL`,
        isNull(postings.jobId),
      ),
    )
    .orderBy(desc(postings.firstSeenAt))
    .limit(200);
}

/**
 * A discovered job still worth a look: untouched (`new`, not archived), with a passing posting
 * or kept by the user (a kept posting keeps its screen reasons but is triaged like any other).
 */
const openDiscovered = sql`${jobs.origin} = 'discovery' AND ${jobs.status} = 'new'
  AND ${jobs.archivedAt} IS NULL
  AND (${jobs.keptAt} IS NOT NULL OR EXISTS (SELECT 1 FROM app_postings p WHERE p.job_id = "app_jobs"."id" AND p.screen_reasons IS NULL))`;

export type TriageCandidate = { id: string; title: string | null; company: string | null };

/** Discovered jobs waiting for triage, newest first (left-overs from earlier runs included). */
export async function jobsAwaitingTriage(db: Db, limit: number): Promise<TriageCandidate[]> {
  return db
    .select({ id: jobs.id, title: jobs.title, company: jobs.company })
    .from(jobs)
    .where(and(openDiscovered, isNull(jobs.triageScore)))
    .orderBy(desc(jobs.createdAt))
    .limit(limit);
}

export async function countAwaitingTriage(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(jobs)
    .where(and(openDiscovered, isNull(jobs.triageScore)));
  return row?.n ?? 0;
}

/** Stores a job's triage (score, one-line reason) against the profile version it used. */
export function saveTriage(
  db: Db,
  jobId: string,
  triage: { score: number; reason: string; profileVersion: number },
): Promise<void> {
  return serializeWrites(db, async () => {
    await db
      .update(jobs)
      .set({
        triageScore: triage.score,
        triageReason: triage.reason,
        triageProfileVersion: triage.profileVersion,
        triagedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  });
}

/**
 * The best new matches to assess fully: discovered jobs triaged since `since` at or above the
 * threshold, still untouched and without an assessment, best first.
 */
export async function jobsToAssess(
  db: Db,
  input: { since: Date; threshold: number; limit: number },
): Promise<{ id: string; triageScore: number | null }[]> {
  if (input.limit <= 0) return [];
  return db
    .select({ id: jobs.id, triageScore: jobs.triageScore })
    .from(jobs)
    .where(
      and(
        openDiscovered,
        gte(jobs.triagedAt, input.since),
        gte(jobs.triageScore, input.threshold),
        notExists(db.select({ x: sql`1` }).from(jobDrafts).where(eq(jobDrafts.jobId, jobs.id))),
      ),
    )
    .orderBy(desc(jobs.triageScore), desc(jobs.createdAt))
    .limit(input.limit);
}

export type DigestMatch = {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  triageScore: number;
  triageReason: string | null;
  /** Headline of the full assessment, when the job got one. */
  headline: string | null;
  sources: DiscoverySource[];
};

/** Matches triaged since `since` at or above the threshold, still untouched, best first. */
export async function digestMatches(
  db: Db,
  input: { since: Date; threshold: number; limit?: number },
): Promise<DigestMatch[]> {
  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      company: jobs.company,
      location: jobs.location,
      triageScore: jobs.triageScore,
      triageReason: jobs.triageReason,
      headline: sql<
        string | null
      >`(select json_extract(d.assessment, '$.headline') from app_job_drafts d
        where d.job_id = "app_jobs"."id" order by d.version desc limit 1)`,
    })
    .from(jobs)
    .where(
      and(
        openDiscovered,
        isNotNull(jobs.triageScore),
        gte(jobs.triagedAt, input.since),
        gte(jobs.triageScore, input.threshold),
      ),
    )
    .orderBy(desc(jobs.triageScore), desc(jobs.createdAt))
    .limit(input.limit ?? 50);
  const sources = await postingSourcesByJob(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    ...r,
    triageScore: r.triageScore ?? 0,
    sources: sources[r.id] ?? [],
  }));
}

/** First time the user opens a discovered job: it stops counting as a new match. */
export function markJobSeen(db: Db, jobId: string): Promise<void> {
  return serializeWrites(db, async () => {
    await db
      .update(jobs)
      .set({ seenAt: new Date() })
      .where(and(eq(jobs.id, jobId), isNull(jobs.seenAt), eq(jobs.origin, "discovery")));
  });
}

/** Discovered matches (visible, triaged) the user hasn't opened yet. */
export async function unseenMatchCount(db: Db): Promise<number> {
  const settings = await getSearchSettings(db);
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(jobs)
    .where(
      and(openDiscovered, isNull(jobs.seenAt), gte(jobs.triageScore, settings.triageThreshold)),
    );
  return row?.n ?? 0;
}
