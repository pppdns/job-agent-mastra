import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SEARCH_SETTINGS,
  type PostingInput,
  type SearchSettings,
  screenPosting,
} from "@copilot/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { listJobs, saveDraft } from "./assessments";
import {
  countAwaitingTriage,
  digestMatches,
  finishDiscoveryRun,
  getSearchSettings,
  interruptStaleDiscoveryRuns,
  jobPostings,
  jobsAwaitingTriage,
  jobsToAssess,
  knownExternalIds,
  listDiscoveryRuns,
  markJobSeen,
  modelSpendByRun,
  modelSpendSince,
  postingSourcesByJob,
  recordFunnel,
  recordPosting,
  recordSourceResult,
  rescreenPostings,
  saveSearchSettings,
  saveTriage,
  sourceSpendSince,
  sourceStates,
  sourceStatsSince,
  startDiscoveryRun,
  unseenMatchCount,
} from "./discovery";
import { createDb, type Db, migrateDb } from "./index";
import { backfillCompanyKeys, latestListingSource, setJobStatus, upsertJob } from "./jobs";
import { latestRunStatuses, recordRunEvents, startRun } from "./runs";
import { type DiscoveryRun, jobs, type SourceRunResult } from "./schema";

let db: Db;

beforeEach(async () => {
  db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "discovery-")), "test.db")}`);
  await migrateDb(db);
});

const now = new Date("2026-11-10T12:00:00Z");

const posting = (over: Partial<PostingInput> = {}): PostingInput => ({
  source: "himalayas",
  externalId: "h-1",
  url: "https://himalayas.app/companies/orbit/jobs/h-1",
  applyUrl: "https://himalayas.app/companies/orbit/jobs/h-1/apply",
  title: "Founding Engineer",
  company: "Orbit Labs Inc.",
  location: "Remote",
  remote: true,
  regions: ["Germany"],
  salaryMin: 90_000,
  salaryMax: 120_000,
  salaryCurrency: "EUR",
  salaryPeriod: "year",
  salaryText: "€90,000–€120,000/year",
  seniority: "Senior",
  employmentType: "Full Time",
  postedAt: new Date("2026-11-08T00:00:00Z"),
  description: "Build the core product with a small team.",
  ...over,
});

const settings = (over: Partial<SearchSettings> = {}): SearchSettings => ({
  ...DEFAULT_SEARCH_SETTINGS,
  ...over,
});

const record = (p: PostingInput, s: SearchSettings = settings(), at = now) =>
  recordPosting(db, { posting: p, screen: screenPosting(s, p, at), runId: "run-1", now: at });

describe("recordPosting", () => {
  it("creates a discovery job with a board snapshot that states date and pay", async () => {
    expect(await record(posting())).toBe("new_job");
    const [job] = await listJobs(db);
    expect(job).toMatchObject({ title: "Founding Engineer", origin: "discovery", status: "new" });
    const source = await latestListingSource(db, job?.id ?? "");
    expect(source).toMatchObject({ kind: "board", provider: "himalayas", postedBasis: "exact" });
    expect(source?.content).toContain("Salary: €90,000–€120,000/year");
    expect(job?.postedAt?.toISOString()).toBe("2026-11-08T00:00:00.000Z");
  });

  it("merges the same job from another board by company key and title", async () => {
    await record(posting());
    const other = posting({
      source: "linkedin",
      externalId: "4480000001",
      url: "https://www.linkedin.com/jobs/view/4480000001/",
      applyUrl: null,
      company: "ORBIT LABS",
      remote: null,
      regions: [],
    });
    expect(await record(other)).toBe("merged");
    const all = await listJobs(db);
    expect(all).toHaveLength(1);
    expect(await postingSourcesByJob(db, [all[0]?.id ?? ""])).toEqual({
      [all[0]?.id ?? ""]: expect.arrayContaining(["himalayas", "linkedin"]),
    });
  });

  it("merges a discovered job into a job shared in chat", async () => {
    const { job } = await upsertJob(db, {
      linkedinJobId: "4479142839",
      canonicalUrl: "https://www.linkedin.com/jobs/view/4479142839/",
      company: "Orbit Labs",
      title: "Founding Engineer",
    });
    expect(await record(posting())).toBe("merged");
    expect((await jobPostings(db, job.id)).map((p) => p.externalId)).toEqual(["h-1"]);
  });

  it("merges by a shared off-board apply URL even when titles differ", async () => {
    const ats = "https://jobs.ashbyhq.com/orbit/123?utm_source=himalayas";
    await record(posting({ applyUrl: ats }));
    const renamed = posting({
      source: "linkedin",
      externalId: "4480000002",
      url: "https://www.linkedin.com/jobs/view/4480000002/",
      applyUrl: "https://jobs.ashbyhq.com/orbit/123",
      title: "Founding Software Engineer",
    });
    expect(await record(renamed)).toBe("merged");
  });

  it("only bumps last seen for a posting seen again, without touching the job", async () => {
    await record(posting());
    const [before] = await db.select().from(jobs);
    const later = new Date(now.getTime() + 3_600_000);
    expect(await record(posting({ title: "Changed" }), settings(), later)).toBe("seen");
    const [after] = await db.select().from(jobs);
    expect(after?.updatedAt).toEqual(before?.updatedAt);
    expect(after?.title).toBe("Founding Engineer");
  });

  it("keeps failing postings as postings only", async () => {
    expect(await record(posting({ title: "Software Engineering Intern" }))).toBe("filtered");
    expect(await listJobs(db, undefined, { includeHidden: true })).toHaveLength(0);
  });
});

describe("rescreenPostings and visibility", () => {
  it("hides untouched discovered jobs that now fail, shows them again, promotes new passes", async () => {
    await record(posting());
    await record(posting({ externalId: "h-2", title: "Sales Engineer", company: "Kite" }));
    expect((await listJobs(db)).map((j) => j.title)).toEqual(["Founding Engineer"]);

    const strict = settings({ blockedCompanies: ["Orbit Labs"], titleExclude: [] });
    const result = await rescreenPostings(
      db,
      (p, i) => screenPosting(strict, p, i.seenAt),
      new Date(0),
    );
    expect(result).toEqual({ checked: 2, promoted: 1, hidden: 1, shown: 0 });
    await saveSearchSettings(db, strict);
    expect((await listJobs(db)).map((j) => j.title)).toEqual(["Sales Engineer"]);
    expect(await listJobs(db, undefined, { includeHidden: true })).toHaveLength(2);

    const loose = settings({ titleExclude: [] });
    const back = await rescreenPostings(
      db,
      (p, i) => screenPosting(loose, p, i.seenAt),
      new Date(0),
    );
    expect(back).toMatchObject({ promoted: 0, hidden: 0, shown: 1 });
    expect(await listJobs(db)).toHaveLength(2);
  });

  it("judges age as of arrival, with the backfill window the posting came in with", async () => {
    const old = posting({ externalId: "h-old", postedAt: new Date("2026-10-20T00:00:00Z") });
    const run = await startDiscoveryRun(db, { trigger: "manual", lookbackDays: 30 });
    await recordPosting(db, {
      posting: old,
      screen: screenPosting(settings(), old, now, 30),
      runId: run?.id ?? "",
      now,
    });
    await record(
      posting({
        externalId: "h-older",
        title: "Staff Engineer",
        postedAt: new Date("2026-10-01T00:00:00Z"),
      }),
    );
    const result = await rescreenPostings(
      db,
      (p, i) => screenPosting(settings(), p, i.seenAt, Math.max(14, i.lookbackDays ?? 0)),
      new Date(0),
    );
    expect(result).toMatchObject({ promoted: 0, hidden: 0 });
    expect((await listJobs(db)).map((j) => j.title)).toEqual(["Founding Engineer"]);
  });

  it("keeps jobs the user acted on visible even when their postings fail", async () => {
    await record(posting());
    const [job] = await listJobs(db);
    await setJobStatus(db, job?.id ?? "", "shortlisted");
    const strict = settings({ blockedCompanies: ["Orbit Labs"] });
    await rescreenPostings(db, (p, i) => screenPosting(strict, p, i.seenAt), new Date(0));
    expect(await listJobs(db)).toHaveLength(1);
  });

  it("hides discovered jobs below the triage threshold", async () => {
    await record(posting());
    await db.update(jobs).set({ triageScore: 40 });
    expect(await listJobs(db)).toHaveLength(0);
    await saveSearchSettings(db, settings({ triageThreshold: 30 }));
    expect(await listJobs(db)).toHaveLength(1);
  });
});

describe("discovery runs", () => {
  it("allows one running run at a time and sweeps interrupted ones", async () => {
    const first = await startDiscoveryRun(db, { trigger: "manual" });
    expect(first).not.toBeNull();
    expect(await startDiscoveryRun(db, { trigger: "schedule" })).toBeNull();
    expect(await interruptStaleDiscoveryRuns(db)).toBe(1);
    expect(await startDiscoveryRun(db, { trigger: "schedule" })).not.toBeNull();
  });

  it("records per-source results and their cost", async () => {
    const run = await startDiscoveryRun(db, { trigger: "manual" });
    const result: SourceRunResult = {
      source: "linkedin",
      status: "ok",
      fetched: 10,
      invalid: 0,
      seen: 2,
      filtered: 3,
      newJobs: 4,
      merged: 1,
      costUsd: 0.12,
      durationMs: 1000,
    };
    await recordSourceResult(db, run?.id ?? "", result);
    await recordSourceResult(db, run?.id ?? "", { ...result, costUsd: 0.2 });
    await finishDiscoveryRun(db, run?.id ?? "", "completed");
    const spend = await sourceSpendSince(db, ["linkedin"], new Date(0));
    expect(spend).toBeCloseTo(0.2);
    expect(await sourceSpendSince(db, ["himalayas"], new Date(0))).toBe(0);
  });

  it("splits discovery model spend into triage and assessments, per run and over time", async () => {
    await startRun(db, { id: "d1", threadId: "discovery:d1" });
    await startRun(db, { id: "c1", threadId: "chat-1" });
    const llm = (runId: string, actor: string, usd: number, at = new Date()) => ({
      runId,
      type: "llm" as const,
      category: "llm" as const,
      name: "m",
      actor,
      status: "ok" as const,
      at,
      estimatedUsd: usd,
    });
    await recordRunEvents(db, [
      llm("d1", "triager", 0.002),
      llm("d1", "triager", 0.003),
      llm("d1", "copilot", 0.05),
      llm("d1", "triager", 1, new Date(0)),
      llm("c1", "copilot", 0.4),
      { ...llm("d1", "triager", 9), type: "provider", category: "search" },
    ]);
    const byRun = await modelSpendByRun(db, ["d1", "missing"]);
    expect(byRun.get("d1")?.triageUsd).toBeCloseTo(1.005);
    expect(byRun.get("d1")?.assessUsd).toBeCloseTo(0.05);
    expect(byRun.has("missing")).toBe(false);
    const recent = await modelSpendSince(db, new Date(Date.now() - 60_000));
    expect(recent.triageUsd).toBeCloseTo(0.005);
    expect(recent.assessUsd).toBeCloseTo(0.05);
  });

  it("derives source cursors and health from recent runs", () => {
    // The cursor is the run's start: a source fetches after it, however long the run takes.
    const run = (sources: SourceRunResult[], startedAt: Date): DiscoveryRun => ({
      id: startedAt.toISOString(),
      trigger: "schedule",
      status: "completed",
      lookbackDays: null,
      error: null,
      sources,
      funnel: null,
      progress: null,
      estimatedUsd: 0,
      workflowRunId: null,
      startedAt,
      endedAt: new Date(startedAt.getTime() + 3_600_000),
    });
    const base = {
      invalid: 0,
      seen: 0,
      filtered: 0,
      newJobs: 0,
      merged: 0,
      costUsd: 0,
      durationMs: 1,
    };
    const runs = [
      run([{ ...base, source: "himalayas", status: "ok", fetched: 0 }], new Date(3)),
      run(
        [
          { ...base, source: "himalayas", status: "ok", fetched: 0 },
          { ...base, source: "linkedin", status: "failed", fetched: 0 },
        ],
        new Date(2),
      ),
      run([{ ...base, source: "linkedin", status: "ok", fetched: 5 }], new Date(1)),
    ];
    const [himalayas, linkedin] = sourceStates(runs, ["himalayas", "linkedin"]);
    expect(himalayas).toMatchObject({ lastOkAt: new Date(3), unhealthy: true });
    expect(linkedin).toMatchObject({ lastOkAt: new Date(1), unhealthy: true });

    // A partial run (one search failed) doesn't move the cursor past the failed window.
    const partial = [
      run([{ ...base, source: "linkedin", status: "partial", fetched: 3 }], new Date(5)),
      ...runs,
    ];
    const [, afterPartial] = sourceStates(partial, ["himalayas", "linkedin"]);
    expect(afterPartial).toMatchObject({ lastOkAt: new Date(1), unhealthy: false });
  });

  it("lists known board ids for a source", async () => {
    await record(posting({ source: "linkedin", externalId: "111" }));
    await record(posting({ source: "linkedin", externalId: "222", title: "Sales Lead" }));
    expect((await knownExternalIds(db, "linkedin", new Date(0))).sort()).toEqual(["111", "222"]);
    expect(await knownExternalIds(db, "himalayas", new Date(0))).toEqual([]);
  });

  it("keeps discovery usage threads out of chat run markers", async () => {
    await startRun(db, { id: "r1", threadId: "discovery:abc" });
    await startRun(db, { id: "r2", threadId: "chat-1" });
    expect(Object.keys(await latestRunStatuses(db))).toEqual(["chat-1"]);
  });
});

describe("triage and matches", () => {
  it("lists untouched discovered jobs awaiting triage, then assess candidates and digest matches", async () => {
    await record(posting());
    await record(posting({ externalId: "h-2", title: "Applied AI Engineer", company: "Kite" }));
    await record(posting({ externalId: "h-3", title: "Staff Engineer", company: "Mole" }));
    const waiting = await jobsAwaitingTriage(db, 10);
    expect(waiting).toHaveLength(3);
    expect(await countAwaitingTriage(db)).toBe(3);

    const start = new Date(Date.now() - 1_000);
    const [a, b, c] = waiting;
    await saveTriage(db, a?.id ?? "", { score: 90, reason: "Strong fit", profileVersion: 1 });
    await saveTriage(db, b?.id ?? "", { score: 65, reason: "Decent", profileVersion: 1 });
    await saveTriage(db, c?.id ?? "", {
      score: 20,
      reason: "On-site in Munich",
      profileVersion: 1,
    });
    expect(await jobsAwaitingTriage(db, 10)).toHaveLength(0);

    const toAssess = await jobsToAssess(db, { since: start, threshold: 60, limit: 1 });
    expect(toAssess).toEqual([{ id: a?.id, triageScore: 90 }]);
    // Without `since` (an assess-only run): every open match, however long ago it was triaged.
    expect(await jobsToAssess(db, { since: new Date(), threshold: 60, limit: 5 })).toEqual([]);
    expect((await jobsToAssess(db, { threshold: 60, limit: 5 })).map((j) => j.triageScore)).toEqual(
      [90, 65],
    );
    const matches = await digestMatches(db, { since: start, threshold: 60 });
    expect(matches.map((m) => m.triageScore)).toEqual([90, 65]);
    const source = await latestListingSource(db, a?.id ?? "");
    await saveDraft(db, {
      jobId: a?.id ?? "",
      assessment: {
        headline: "Strong remote founding role",
        overview: "o",
        fitBasis: "role_only",
        strengths: [{ text: "s", evidence: "official", sourceIds: [source?.id ?? ""] }],
        recommendation: { verdict: "pursue", rationale: "r" },
      },
    });
    const withHeadline = await digestMatches(db, { since: start, threshold: 60 });
    expect(withHeadline[0]?.headline).toBe("Strong remote founding role");
    expect(matches[0]?.sources).toEqual(["himalayas"]);
    // Below the threshold: hidden from the list, not a match.
    expect(await listJobs(db)).toHaveLength(2);

    expect(await unseenMatchCount(db)).toBe(2);
    await markJobSeen(db, a?.id ?? "");
    expect(await unseenMatchCount(db)).toBe(1);
  });

  it("adds the funnel's model cost to the run's cost", async () => {
    const run = await startDiscoveryRun(db, { trigger: "manual" });
    const funnel = {
      triaged: 3,
      triageFailed: 0,
      triagePending: 0,
      matched: 2,
      assessed: 1,
      assessFailed: 0,
      llmUsd: 0.05,
    };
    await recordFunnel(db, run?.id ?? "", funnel);
    await recordSourceResult(db, run?.id ?? "", {
      source: "linkedin",
      status: "ok",
      fetched: 1,
      invalid: 0,
      seen: 0,
      filtered: 0,
      newJobs: 1,
      merged: 0,
      costUsd: 0.1,
      durationMs: 1,
    });
    const [row] = await listDiscoveryRuns(db, 1);
    expect(row?.estimatedUsd).toBeCloseTo(0.15);
    expect(row?.funnel).toEqual(funnel);
  });
});

describe("source stats", () => {
  it("counts postings, screen passes, overlap with other boards, matches and cost", async () => {
    await record(posting());
    await record(
      posting({ source: "linkedin", externalId: "1", company: "Orbit Labs", applyUrl: null }),
    );
    await record(posting({ externalId: "h-2", title: "Platform Engineer" }));
    await record(posting({ externalId: "h-3", title: "Sales Lead" }));
    const all = await listJobs(db);
    const founding = all.find((j) => j.title === "Founding Engineer");
    const platform = all.find((j) => j.title === "Platform Engineer");
    await saveTriage(db, founding?.id ?? "", { score: 80, reason: "Good", profileVersion: 1 });
    await saveTriage(db, platform?.id ?? "", { score: 75, reason: "Good", profileVersion: 1 });
    const run = await startDiscoveryRun(db, { trigger: "manual" });
    await recordSourceResult(db, run?.id ?? "", {
      source: "linkedin",
      status: "ok",
      fetched: 1,
      invalid: 0,
      seen: 0,
      filtered: 0,
      newJobs: 0,
      merged: 1,
      costUsd: 0.02,
      durationMs: 1,
    });
    const stats = await sourceStatsSince(
      db,
      ["himalayas", "linkedin", "remoteok"],
      new Date(0),
      60,
    );
    expect(stats).toEqual([
      {
        source: "himalayas",
        postings: 3,
        passed: 2,
        jobs: 2,
        duplicates: 1,
        matches: 2,
        uniqueMatches: 1,
        costUsd: 0,
      },
      {
        source: "linkedin",
        postings: 1,
        passed: 1,
        jobs: 1,
        duplicates: 1,
        matches: 1,
        uniqueMatches: 0,
        costUsd: 0.02,
      },
      {
        source: "remoteok",
        postings: 0,
        passed: 0,
        jobs: 0,
        duplicates: 0,
        matches: 0,
        uniqueMatches: 0,
        costUsd: 0,
      },
    ]);
  });
});

describe("search settings and backfill", () => {
  it("stores one settings row and parses it with defaults", async () => {
    expect(await getSearchSettings(db)).toEqual(DEFAULT_SEARCH_SETTINGS);
    await saveSearchSettings(db, settings({ queries: ["Staff Engineer"] }));
    await saveSearchSettings(db, settings({ queries: ["Principal Engineer"] }));
    expect((await getSearchSettings(db)).queries).toEqual(["Principal Engineer"]);
  });

  it("fills company keys and company-key dedupe keys for older jobs", async () => {
    const { job } = await upsertJob(db, { company: "Orbit Labs GmbH", title: "Engineer" });
    await db
      .update(jobs)
      .set({ companyKey: null, dedupeKey: "orbit labs gmbh|engineer" })
      .where(eq(jobs.id, job.id));
    expect(await backfillCompanyKeys(db)).toBe(1);
    const [row] = await db.select().from(jobs);
    expect(row).toMatchObject({ companyKey: "orbit labs", dedupeKey: "orbit labs|engineer" });
    expect(await backfillCompanyKeys(db)).toBe(0);
  });
});
