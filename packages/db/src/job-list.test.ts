import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SEARCH_SETTINGS, type PostingInput, screenPosting } from "@copilot/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { listJobs, saveDraft } from "./assessments";
import {
  digestMatches,
  jobsAwaitingTriage,
  jobsToAssess,
  keepPosting,
  recordPosting,
  saveTriage,
  startDiscoveryRun,
  unseenMatchCount,
} from "./discovery";
import { createDb, type Db, migrateDb } from "./index";
import {
  assessedJobCounts,
  belowThresholdJobs,
  companyJobCounts,
  companyJobs,
  jobTabCounts,
  keepJob,
  listJobsPage,
  resetStaleTriage,
  screenedOutPostings,
  setJobsStatus,
  staleTriageCount,
} from "./job-list";
import { addSource, setJobStatus, upsertJob } from "./jobs";
import { decideApproval, proposeProfileChange } from "./profile";
import { jobs, postings, sources } from "./schema";

let db: Db;
let runId: string;

beforeEach(async () => {
  db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "joblist-")), "test.db")}`);
  await migrateDb(db);
  runId = (await startDiscoveryRun(db, { trigger: "manual" }))?.id ?? "";
});

const now = new Date();
const DAY = 86_400_000;

const posting = (id: string, over: Partial<PostingInput> = {}): PostingInput => ({
  source: "himalayas",
  externalId: id,
  url: `https://himalayas.app/companies/x/jobs/${id}`,
  applyUrl: null,
  title: `Role ${id}`,
  company: `Company ${id}`,
  location: "Remote",
  remote: true,
  regions: [],
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
  salaryText: null,
  seniority: null,
  employmentType: null,
  postedAt: new Date(now.getTime() - DAY),
  description: "Build.",
  ...over,
});

async function discovered(id: string, score: number | null, over: Partial<PostingInput> = {}) {
  const p = posting(id, over);
  await recordPosting(db, {
    posting: p,
    screen: screenPosting(DEFAULT_SEARCH_SETTINGS, p, now),
    runId,
  });
  const [row] = await db.select().from(postings).where(eq(postings.externalId, id));
  const jobId = row?.jobId ?? "";
  if (score !== null)
    await saveTriage(db, jobId, { score, reason: `score ${score}`, profileVersion: 0 });
  return jobId;
}

async function assessed(title: string, fitLevel: "strong" | "weak") {
  const { approval } = await proposeProfileChange(db, {
    threadId: "t",
    proposal: {
      changes: [{ op: "add", kind: "hard_requirement", text: `Remote ${title}` }],
      reason: "test profile",
    },
  });
  await decideApproval(db, {
    approvalId: approval.id,
    threadId: "t",
    decision: "approve",
    payloadHash: approval.payloadHash,
  });
  const { job } = await upsertJob(db, { company: `Chat ${title}`, title });
  const { source } = await addSource(db, {
    jobId: job.id,
    kind: "pasted",
    provider: "user",
    content: `# ${title}`,
  });
  const factId = (await db.query.profileFacts.findFirst())?.id ?? "";
  await saveDraft(db, {
    jobId: job.id,
    assessment: {
      overview: "o",
      fitBasis: "with_profile",
      fitLevel,
      strengths: [{ text: "s", evidence: "official", sourceIds: [source.id] }],
      weaknesses: [{ text: "fit", evidence: "inference", profileFactIds: [factId] }],
      recommendation: { verdict: "pursue", rationale: "r" },
    },
  });
  return job.id;
}

describe("listJobsPage", () => {
  it("pages, counts the total, and keeps hidden jobs out", async () => {
    for (let i = 0; i < 5; i++) await discovered(`p${i}`, 70);
    await discovered("hidden", 20);
    const page = await listJobsPage(db, { tab: "active", sort: "latest", limit: 2, offset: 2 });
    expect(page.total).toBe(5);
    expect(page.jobs).toHaveLength(2);
  });

  it("ranks assessed and triaged jobs on one scale for best fit, unscored last", async () => {
    const strong = await assessed("Strong", "strong");
    const weak = await assessed("Weak", "weak");
    const t90 = await discovered("t90", 90);
    const t70 = await discovered("t70", 70);
    const pending = await discovered("pending", null);
    const page = await listJobsPage(db, { tab: "active", sort: "fit", limit: 10, offset: 0 });
    expect(page.jobs.map((j) => j.id)).toEqual([strong, t90, t70, weak, pending]);
  });

  it("filters by source, score, posted date and unseen; keeps search order for latest", async () => {
    const a = await discovered("a", 90, { postedAt: new Date(now.getTime() - 2 * DAY) });
    const b = await discovered("b", 65, {
      source: "linkedin",
      postedAt: new Date(now.getTime() - 10 * DAY),
    });
    await db.update(jobs).set({ seenAt: now }).where(eq(jobs.id, b));
    const ids = (q: Parameters<typeof listJobsPage>[1]) =>
      listJobsPage(db, q).then((r) => r.jobs.map((j) => j.id));
    const base = { tab: "active" as const, sort: "latest" as const, limit: 10, offset: 0 };
    expect(await ids({ ...base, source: "linkedin" })).toEqual([b]);
    expect(await ids({ ...base, minScore: 80 })).toEqual([a]);
    expect(await ids({ ...base, postedWithinDays: 7 })).toEqual([a]);
    expect(await ids({ ...base, unseen: true })).toEqual([a]);
    expect(await ids({ ...base, ids: [b, a] })).toEqual([b, a]);
    expect(await ids({ ...base, ids: [] })).toEqual([]);
  });

  it("counts tabs in SQL with the same filters", async () => {
    const a = await discovered("a", 90);
    await discovered("b", 70);
    const c = await discovered("c", 70);
    await setJobStatus(db, a, "shortlisted");
    await setJobStatus(db, c, "dismissed");
    const counts = await jobTabCounts(db, {});
    expect(counts).toMatchObject({ active: 2, new: 1, shortlisted: 1, archived: 1, dismissed: 0 });
    expect((await jobTabCounts(db, { minScore: 80 })).active).toBe(1);
  });
});

describe("screened out, keep anyway, bulk, re-triage", () => {
  it("lists below-threshold jobs and dropped postings; keeping makes them visible", async () => {
    const low = await discovered("low", 20);
    await discovered("intern", null, { title: "Software Intern" });
    const below = await belowThresholdJobs(db, { limit: 10 });
    expect(below.jobs.map((j) => j.id)).toEqual([low]);
    const dropped = await screenedOutPostings(db, { since: new Date(0), limit: 10 });
    expect(dropped.total).toBe(1);
    expect(dropped.postings[0]?.reasons).toEqual(['title contains "intern"']);

    await keepJob(db, low);
    const jobId = await keepPosting(db, dropped.postings[0]?.id ?? "");
    const visible = (await listJobs(db)).map((j) => j.id);
    expect(visible).toEqual(expect.arrayContaining([low, jobId]));
    expect((await belowThresholdJobs(db, { limit: 10 })).total).toBe(0);
    expect((await screenedOutPostings(db, { since: new Date(0), limit: 10 })).total).toBe(0);
  });

  it("triages kept postings, and lists jobs whose postings all fail after a re-screen", async () => {
    await discovered("intern", null, { title: "Software Intern" });
    const dropped = await screenedOutPostings(db, { since: new Date(0), limit: 10 });
    const kept = await keepPosting(db, dropped.postings[0]?.id ?? "");
    expect((await jobsAwaitingTriage(db, 10)).map((j) => j.id)).toContain(kept);

    const job = await discovered("blocked", 80, { company: "Mole" });
    await db
      .update(postings)
      .set({ screenReasons: ["company Mole is blocked"] })
      .where(eq(postings.jobId, job));
    const hidden = await belowThresholdJobs(db, { limit: 10 });
    expect(hidden.jobs.find((j) => j.id === job)?.screenReasons).toEqual([
      "company Mole is blocked",
    ]);
  });

  it("sets a status on many jobs, counts assessed and per-company jobs", async () => {
    const a = await discovered("a", 80, { company: "Kite GmbH" });
    const b = await discovered("b", 80, { company: "Kite", title: "Other" });
    expect(await setJobsStatus(db, [a, b], "dismissed")).toBe(2);
    expect((await jobTabCounts(db, {})).archived).toBe(2);
    await setJobsStatus(db, [a, b], "shortlisted");
    expect(await companyJobCounts(db, ["kite"])).toEqual({ kite: 2 });
    await assessed("Strong", "strong");
    expect(await assessedJobCounts(db)).toEqual({ active: 1, stale: 0 });
  });

  it("clears triage made against an older profile so the next run redoes it", async () => {
    const a = await discovered("a", 80);
    await assessed("Strong", "strong"); // approves profile v1
    expect(await staleTriageCount(db)).toBe(1);
    expect(await resetStaleTriage(db)).toBe(1);
    const [row] = await db.select().from(jobs).where(eq(jobs.id, a));
    expect(row?.triageScore).toBeNull();
    expect(await staleTriageCount(db)).toBe(0);
  });
});

describe("subqueries in select fields", () => {
  it("company pages flag hidden roles, digests carry assessment headlines", async () => {
    const shown = await discovered("shown", 80, { company: "Kite" });
    const hidden = await discovered("hidden", 20, { company: "Kite", title: "Hidden role" });
    const roles = await companyJobs(db, "kite");
    expect(Object.fromEntries(roles.map((r) => [r.id, r.hidden]))).toEqual({
      [shown]: false,
      [hidden]: true,
    });
  });
});

describe("location blocks", () => {
  const US_ONLY = "US-only: you must reside in the United States.";
  const block = { places: ["United States"], quote: "you must reside in the United States" };

  async function assess(jobId: string, over: Record<string, unknown> = {}) {
    const [source] = await db.select().from(sources).where(eq(sources.jobId, jobId));
    return saveDraft(db, {
      jobId,
      assessment: {
        overview: "Remote role, US residents only.",
        fitBasis: "role_only",
        hardConflicts: [
          { text: "US residents only", evidence: "official", sourceIds: [source?.id ?? ""] },
        ],
        recommendation: { verdict: "pass", rationale: "Excludes where you live." },
        locationBlock: block,
        ...over,
      },
    });
  }

  it("hides a discovered job an assessment blocks, until it is kept or a new draft clears it", async () => {
    const id = await discovered("a", 80, { description: US_ONLY });
    await assess(id);
    expect(await listJobs(db)).toEqual([]);
    const below = await belowThresholdJobs(db, { limit: 10 });
    expect(below.jobs.map((j) => [j.id, j.locationBlock?.from])).toEqual([[id, "assessment"]]);
    expect((await jobTabCounts(db, {})).active).toBe(0);

    await assess(id, {
      locationBlock: null,
      recommendation: { verdict: "consider", rationale: "ok" },
    });
    expect((await listJobs(db)).map((j) => j.id)).toEqual([id]);

    await assess(id);
    await keepJob(db, id);
    expect((await listJobs(db)).map((j) => j.id)).toEqual([id]);
  });

  it("rejects a block whose quote isn't in the listing or that isn't a hard pass", async () => {
    const id = await discovered("a", 80, { description: US_ONLY });
    await expect(
      assess(id, { locationBlock: { places: ["United Kingdom"], quote: "UK residents only" } }),
    ).rejects.toThrow(/not in this job's listing/);
    await expect(
      assess(id, { recommendation: { verdict: "investigate_further", rationale: "?" } }),
    ).rejects.toThrow(/verdict pass/);
    await expect(assess(id, { hardConflicts: [] })).rejects.toThrow(/hard conflict/);
  });

  it("keeps chat jobs and jobs the user acted on visible", async () => {
    const { job } = await upsertJob(db, { company: "Contoso", title: "SRE" });
    await addSource(db, { jobId: job.id, kind: "pasted", provider: "user", content: US_ONLY });
    await assess(job.id);
    const acted = await discovered("b", 80, { description: US_ONLY });
    await assess(acted);
    await setJobStatus(db, acted, "shortlisted");
    expect((await listJobs(db)).map((j) => j.id).sort()).toEqual([job.id, acted].sort());
  });

  it("re-triage clears a triage block but keeps an assessment's", async () => {
    const fromTriage = await discovered("a", null, { description: US_ONLY });
    await saveTriage(db, fromTriage, {
      score: 39,
      reason: "r",
      profileVersion: 0,
      locationBlock: block,
    });
    const fromDraft = await discovered("b", 80, { description: US_ONLY });
    await assess(fromDraft);
    await saveTriage(db, fromDraft, { score: 80, reason: "r", profileVersion: 0 });
    const blocks = async () =>
      Object.fromEntries(
        (await db.select({ id: jobs.id, b: jobs.locationBlock }).from(jobs)).map((r) => [
          r.id,
          r.b?.from ?? null,
        ]),
      );
    expect(await blocks()).toEqual({ [fromTriage]: "triage", [fromDraft]: "assessment" });
    const { approval } = await proposeProfileChange(db, {
      threadId: "t",
      proposal: {
        changes: [{ op: "add", kind: "background", text: "Lives in Hungary" }],
        reason: "test profile",
      },
    });
    await decideApproval(db, {
      approvalId: approval.id,
      threadId: "t",
      decision: "approve",
      payloadHash: approval.payloadHash,
    });
    await resetStaleTriage(db);
    expect(await blocks()).toEqual({ [fromTriage]: null, [fromDraft]: "assessment" });
  });

  it("ignores research pages when checking the quote", async () => {
    const id = await discovered("a", 80);
    await addSource(db, {
      jobId: id,
      kind: "web",
      provider: "tavily",
      url: "https://example.com/about",
      content: US_ONLY,
    });
    await expect(assess(id)).rejects.toThrow(/not in this job's listing/);
  });

  it("leaves blocked jobs out of matches to assess, email and count", async () => {
    const since = new Date(Date.now() - 60_000);
    const id = await discovered("a", 80, { description: US_ONLY });
    await saveTriage(db, id, { score: 80, reason: "r", profileVersion: 0, locationBlock: block });
    const args = { since, threshold: 0, limit: 10 };
    expect(await jobsToAssess(db, args)).toEqual([]);
    expect(await digestMatches(db, args)).toEqual([]);
    expect(await unseenMatchCount(db)).toBe(0);
    await keepJob(db, id);
    expect((await digestMatches(db, args)).map((m) => m.id)).toEqual([id]);
  });

  it("never lets triage change an assessed job's block", async () => {
    const cleared = await discovered("a", 80, { description: US_ONLY });
    await assess(cleared, {
      locationBlock: null,
      recommendation: { verdict: "consider", rationale: "ok" },
    });
    await saveTriage(db, cleared, {
      score: 39,
      reason: "r",
      profileVersion: 0,
      locationBlock: block,
    });
    const blocked = await discovered("b", 80, { description: US_ONLY });
    await assess(blocked);
    await saveTriage(db, blocked, {
      score: 39,
      reason: "r",
      profileVersion: 0,
      locationBlock: block,
    });
    const rows = await db.select({ id: jobs.id, b: jobs.locationBlock }).from(jobs);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.b?.from ?? null]));
    expect(byId).toEqual({ [cleared]: null, [blocked]: "assessment" });
  });
});
