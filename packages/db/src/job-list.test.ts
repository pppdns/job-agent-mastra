import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SEARCH_SETTINGS, type PostingInput, screenPosting } from "@copilot/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { listJobs, saveDraft } from "./assessments";
import {
  jobsAwaitingTriage,
  keepPosting,
  recordPosting,
  saveTriage,
  startDiscoveryRun,
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
import { jobs, postings } from "./schema";

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
