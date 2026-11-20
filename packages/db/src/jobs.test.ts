import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getJobDetail, listJobs } from "./assessments";
import { createDb, type Db, migrateDb } from "./index";
import { listPipelineJobs } from "./job-list";
import {
  addSource,
  backfillAtsKeys,
  backfillPostedDates,
  dedupeKey,
  findJobByUrl,
  latestListingSource,
  MAX_SNAPSHOT_CHARS,
  setInterviewRounds,
  setJobArchived,
  setJobNotes,
  setJobStatus,
  setJobTop,
  upsertJob,
} from "./jobs";
import { jobs, sources } from "./schema";

let db: Db;

beforeEach(async () => {
  // A file, not :memory:, so transactions share the connection's database.
  db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "jobs-")), "test.db")}`);
  await migrateDb(db);
});

const northwind = { company: "Northwind Robotics", title: "Senior Platform Engineer" };

describe("upsertJob", () => {
  it("dedupes by LinkedIn job id and fills in missing fields", async () => {
    const first = await upsertJob(db, { linkedinJobId: "4479142839", ...northwind });
    const again = await upsertJob(db, {
      linkedinJobId: "4479142839",
      canonicalUrl: "https://www.linkedin.com/jobs/view/4479142839/",
      company: "Renamed Co",
      location: "Lisbon",
    });
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.job.id).toBe(first.job.id);
    expect(again.job.company).toBe("Northwind Robotics");
    expect(again.job.location).toBe("Lisbon");
    expect(again.job.canonicalUrl).toBe("https://www.linkedin.com/jobs/view/4479142839/");
  });

  it("dedupes by canonical URL", async () => {
    const url = "https://job-boards.greenhouse.io/northwind/jobs/1";
    const first = await upsertJob(db, { canonicalUrl: url });
    expect((await upsertJob(db, { canonicalUrl: url, ...northwind })).job.id).toBe(first.job.id);
  });

  it("matches pasted text to a LinkedIn job by normalized company and title", async () => {
    const linkedin = await upsertJob(db, { linkedinJobId: "111111", ...northwind });
    const pasted = await upsertJob(db, {
      company: "northwind robotics",
      title: "Senior Platform-Engineer",
    });
    expect(pasted.job.id).toBe(linkedin.job.id);
  });

  it("keeps two LinkedIn postings with the same company and title apart", async () => {
    const a = await upsertJob(db, { linkedinJobId: "111111", ...northwind });
    const b = await upsertJob(db, { linkedinJobId: "222222", ...northwind });
    expect(b.created).toBe(true);
    expect(b.job.id).not.toBe(a.job.id);
  });

  it("creates separate jobs when nothing identifies the listing", async () => {
    const a = await upsertJob(db, {});
    const b = await upsertJob(db, {});
    expect(a.job.id).not.toBe(b.job.id);
  });
});

describe("ATS keys", () => {
  const gh = "https://boards.greenhouse.io/northwind/jobs/5290677007";

  it("matches the same ATS job under another URL form, with no title to go on", async () => {
    const first = await upsertJob(db, { canonicalUrl: gh, ...northwind });
    expect(first.job.atsKey).toBe("greenhouse:northwind:5290677007");
    const again = await upsertJob(db, {
      canonicalUrl: "https://job-boards.greenhouse.io/northwind/jobs/5290677007",
      company: "Northwind",
      title: "Platform Engineer (Remote)",
    });
    expect(again).toMatchObject({ created: false, job: { id: first.job.id } });
    expect(await findJobByUrl(db, { urls: [`${gh}/apply?gh_src=li`] })).toMatchObject({
      id: first.job.id,
    });
  });

  it("keeps two ATS jobs with the same company and title apart, and fills a LinkedIn match", async () => {
    const a = await upsertJob(db, { canonicalUrl: gh, ...northwind });
    const b = await upsertJob(db, {
      canonicalUrl: "https://boards.greenhouse.io/northwind/jobs/5290677008",
      ...northwind,
    });
    expect(b.created).toBe(true);
    // A LinkedIn job (no URL) later seen on the ATS gets the key; it never steals a taken one.
    const li = await upsertJob(db, { linkedinJobId: "1", company: "Other", title: "Role" });
    const filled = await upsertJob(db, {
      linkedinJobId: "1",
      canonicalUrl: "https://jobs.lever.co/other/9f47da32-dd07-46ea-94ea-1e77d661af92",
    });
    expect(filled.job).toMatchObject({ id: li.job.id, atsKey: expect.stringMatching(/^lever:/) });
    const clash = await upsertJob(db, { linkedinJobId: "1", canonicalUrl: gh });
    expect(clash.job.atsKey).toBe(filled.job.atsKey);
    expect(a.job.id).not.toBe(b.job.id);
  });

  it("backfills keys from canonical URLs, once and without clashes", async () => {
    const { job } = await upsertJob(db, { canonicalUrl: gh, ...northwind });
    await db.update(jobs).set({ atsKey: null }).where(eq(jobs.id, job.id));
    await upsertJob(db, { canonicalUrl: "https://example.com/careers/1", title: "x" });
    expect(await backfillAtsKeys(db)).toBe(1);
    expect(await backfillAtsKeys(db)).toBe(0);
  });
});

describe("addSource", () => {
  it("is idempotent for the same content (retry after a lost response)", async () => {
    const { job } = await upsertJob(db, northwind);
    const input = { jobId: job.id, kind: "pasted", provider: "user", content: "listing" } as const;
    const first = await addSource(db, input);
    const retry = await addSource(db, input);
    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.source.id).toBe(first.source.id);
  });

  it("bounds the snapshot and marks it truncated", async () => {
    const { job } = await upsertJob(db, northwind);
    const { source } = await addSource(db, {
      jobId: job.id,
      kind: "web",
      provider: "tavily",
      content: "x".repeat(MAX_SNAPSHOT_CHARS + 10),
    });
    expect(source.content).toHaveLength(MAX_SNAPSHOT_CHARS);
    expect(source.truncated).toBe(true);
  });
});

describe("latestListingSource", () => {
  it("returns the newest listing, not a research page", async () => {
    const url = "https://jobs.example/northwind/1";
    const { job } = await upsertJob(db, { ...northwind, canonicalUrl: url });
    const at = (ms: number) => new Date(ms);
    await addSource(db, {
      jobId: job.id,
      kind: "pasted",
      provider: "user",
      content: "old",
      retrievedAt: at(1),
    });
    await addSource(db, {
      jobId: job.id,
      kind: "web",
      provider: "tavily",
      url,
      content: "listing",
      retrievedAt: at(2),
    });
    await addSource(db, {
      jobId: job.id,
      kind: "web",
      provider: "tavily",
      url: "https://news.example/northwind",
      content: "research page",
      retrievedAt: at(3),
    });
    expect((await latestListingSource(db, job.id))?.content).toBe("listing");
    expect(await latestListingSource(db, "missing")).toBeUndefined();
  });
});

describe("posted dates", () => {
  const DAY = 86_400_000;
  const readAt = new Date("2026-11-09T12:00:00Z");
  const linkedIn = (age: string) =>
    `# Senior Platform Engineer\n\n#### [Northwind Robotics](https://www.linkedin.com/company/northwind) Lisbon ${age}\n\nBody`;

  it("stores the posting date a listing states when the source is saved", async () => {
    const { job } = await upsertJob(db, northwind);
    const { source } = await addSource(db, {
      jobId: job.id,
      kind: "linkedin",
      provider: "tavily",
      content: linkedIn("2 weeks ago"),
      retrievedAt: readAt,
    });
    expect(source.postedAt).toEqual(new Date(readAt.getTime() - 14 * DAY));
    expect(source.postedBasis).toBe("relative");
    const { source: none } = await addSource(db, {
      jobId: job.id,
      kind: "pasted",
      provider: "user",
      content: "no date here",
    });
    expect(none).toMatchObject({ postedAt: null, postedBasis: "none" });
  });

  it("backfills sources saved before dates were parsed, once", async () => {
    const { job } = await upsertJob(db, northwind);
    const { source } = await addSource(db, {
      jobId: job.id,
      kind: "ats",
      provider: "tavily",
      content: "# Job\n\nDate posted: 2026-03-02",
      retrievedAt: readAt,
    });
    await db
      .update(sources)
      .set({ postedAt: null, postedBasis: null })
      .where(eq(sources.id, source.id));
    expect(await backfillPostedDates(db)).toBe(1);
    expect(await backfillPostedDates(db)).toBe(0);
    const [overview] = await listJobs(db);
    expect(overview).toMatchObject({
      postedAt: new Date(Date.UTC(2026, 2, 2)),
      postedBasis: "exact",
    });
  });

  it("uses the latest dated listing source, never a research page", async () => {
    const url = "https://jobs.example/northwind/1";
    const { job } = await upsertJob(db, { ...northwind, canonicalUrl: url });
    const add = (kind: "linkedin" | "web" | "ats", content: string, ms: number, src?: string) =>
      addSource(db, {
        jobId: job.id,
        kind,
        provider: "tavily",
        url: src ?? null,
        content,
        retrievedAt: new Date(readAt.getTime() + ms),
      });
    await add("linkedin", linkedIn("3 weeks ago"), 0);
    await add("linkedin", linkedIn("Reposted 1 week ago"), 1);
    // Newer, but without a date: the dated one above still counts.
    await add("ats", "# Job\n\nNo date", 2);
    // Research page with a date: never the job's posting date.
    await add("web", "# News\n\nPublished: 2026-11-01", 3, "https://news.example/x");

    const expected = { at: new Date(readAt.getTime() + 1 - 7 * DAY), basis: "reposted" };
    expect((await getJobDetail(db, job.id))?.posted).toEqual(expected);
    const [overview] = await listJobs(db);
    expect(overview).toMatchObject({ postedAt: expected.at, postedBasis: "reposted" });
  });

  it("is null when no listing states a date", async () => {
    const { job } = await upsertJob(db, northwind);
    expect((await getJobDetail(db, job.id))?.posted).toBeNull();
    expect((await listJobs(db))[0]).toMatchObject({ postedAt: null, postedBasis: null });
  });
});

describe("dedupeKey", () => {
  it("ignores case, accents and punctuation", () => {
    expect(dedupeKey("Café Robotics, Inc.", "Senior  Engineer (Platform)")).toBe(
      dedupeKey("cafe robotics inc", "senior engineer platform"),
    );
  });
});

describe("job status", () => {
  it("defaults to new and stamps status changes", async () => {
    const { job } = await upsertJob(db, northwind);
    expect(job.status).toBe("new");
    expect(job.statusChangedAt).toBeNull();
    const applied = await setJobStatus(db, job.id, "applied");
    expect(applied?.status).toBe("applied");
    expect(applied?.statusChangedAt).toBeInstanceOf(Date);
    expect(applied?.archivedAt).toBeNull();
  });

  it("archives closing statuses and unarchives when reopened", async () => {
    const { job } = await upsertJob(db, northwind);
    const dismissed = await setJobStatus(db, job.id, "dismissed");
    expect(dismissed?.archivedAt).toBeInstanceOf(Date);
    const rejected = await setJobStatus(db, job.id, "rejected");
    expect(rejected?.archivedAt?.getTime()).toBe(dismissed?.archivedAt?.getTime());
    const reopened = await setJobStatus(db, job.id, "shortlisted");
    expect(reopened?.archivedAt).toBeNull();
  });

  it("is a no-op for the current status and undefined for unknown jobs", async () => {
    const { job } = await upsertJob(db, northwind);
    const first = await setJobStatus(db, job.id, "applied");
    const again = await setJobStatus(db, job.id, "applied");
    expect(again?.statusChangedAt?.getTime()).toBe(first?.statusChangedAt?.getTime());
    expect(await setJobStatus(db, "missing", "applied")).toBeUndefined();
    expect(await setJobArchived(db, "missing", true)).toBeUndefined();
  });

  it("archives manually without changing the status, and keeps re-upserts from resetting it", async () => {
    const { job } = await upsertJob(db, northwind);
    await setJobStatus(db, job.id, "applied");
    const archived = await setJobArchived(db, job.id, true);
    expect(archived?.status).toBe("applied");
    expect(archived?.archivedAt).toBeInstanceOf(Date);
    const { job: again } = await upsertJob(db, northwind);
    expect(again.status).toBe("applied");
    expect(again.archivedAt).toBeInstanceOf(Date);
    expect((await setJobArchived(db, job.id, false))?.archivedAt).toBeNull();
  });

  it("lists status fields", async () => {
    const { job } = await upsertJob(db, northwind);
    await setJobStatus(db, job.id, "dismissed");
    const [overview] = await listJobs(db);
    expect(overview).toMatchObject({ id: job.id, status: "dismissed" });
    expect(overview?.archivedAt).toBeInstanceOf(Date);
    expect(overview?.createdAt).toBeInstanceOf(Date);
  });
});

describe("pipeline progress", () => {
  it("stamps progress on status changes and starts interviews at round 1", async () => {
    const { job } = await upsertJob(db, northwind);
    const applied = await setJobStatus(db, job.id, "applied");
    expect(applied?.progressedAt?.getTime()).toBe(applied?.statusChangedAt?.getTime());
    expect(applied?.interviewRound).toBeNull();
    const interviewing = await setJobStatus(db, job.id, "interviewing");
    expect(interviewing?.interviewRound).toBe(1);
    await setInterviewRounds(db, job.id, { round: 3, total: 4 });
    await setJobStatus(db, job.id, "offer");
    const back = await setJobStatus(db, job.id, "interviewing");
    expect(back).toMatchObject({ interviewRound: 3, interviewRounds: 4 });
  });

  it("counts a new round as progress, a new total alone not", async () => {
    const { job } = await upsertJob(db, northwind);
    await setJobStatus(db, job.id, "interviewing");
    const old = new Date("2026-01-01T00:00:00Z");
    await db.update(jobs).set({ progressedAt: old }).where(eq(jobs.id, job.id));
    const total = await setInterviewRounds(db, job.id, { round: 1, total: 5 });
    expect(total?.interviewRounds).toBe(5);
    expect(total?.progressedAt?.getTime()).toBe(old.getTime());
    const next = await setInterviewRounds(db, job.id, { round: 2, total: 5 });
    expect(next?.interviewRound).toBe(2);
    expect(next?.progressedAt?.getTime()).toBeGreaterThan(old.getTime());
  });

  it("clamps the round to the total and rejects out-of-range numbers", async () => {
    const { job } = await upsertJob(db, northwind);
    expect(await setInterviewRounds(db, job.id, { round: 4, total: 2 })).toMatchObject({
      interviewRound: 2,
      interviewRounds: 2,
    });
    expect(await setInterviewRounds(db, job.id, { round: 6, total: null })).toMatchObject({
      interviewRound: 6,
      interviewRounds: null,
    });
    await expect(setInterviewRounds(db, job.id, { round: 0, total: null })).rejects.toThrow();
    await expect(setInterviewRounds(db, job.id, { round: 1, total: 13 })).rejects.toThrow();
    await expect(setInterviewRounds(db, job.id, { round: 1.5, total: null })).rejects.toThrow();
    expect(await setInterviewRounds(db, "missing", { round: 1, total: null })).toBeUndefined();
  });

  it("lists in-progress jobs, least recent progress first", async () => {
    const a = (await upsertJob(db, northwind)).job;
    const b = (await upsertJob(db, { company: "Acme", title: "Staff Engineer" })).job;
    const c = (await upsertJob(db, { company: "Globex", title: "Engineer" })).job;
    await upsertJob(db, { company: "Initech", title: "Engineer" }); // new: not listed
    await setJobStatus(db, a.id, "applied");
    await setJobStatus(db, b.id, "shortlisted");
    await setJobStatus(db, c.id, "offer");
    await setJobArchived(db, c.id, true);
    await db
      .update(jobs)
      .set({ progressedAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(jobs.id, b.id));
    const listed = await listPipelineJobs(db);
    expect(listed.map((j) => j.id)).toEqual([b.id, a.id]);
    expect(listed[0]).toMatchObject({ status: "shortlisted", hasNotes: false });
  });
});

describe("job notes", () => {
  it("saves, trims, clears, and flags notes in the list", async () => {
    const { job } = await upsertJob(db, northwind);
    const saved = await setJobNotes(db, job.id, "  Round 1: recruiter call\n", null);
    expect(saved).toMatchObject({ status: "saved", notes: "Round 1: recruiter call" });
    const [overview] = await listJobs(db);
    expect(overview?.hasNotes).toBe(true);
    const at = saved.status === "saved" ? saved.notesUpdatedAt : null;
    const cleared = await setJobNotes(db, job.id, "   ", at);
    expect(cleared).toMatchObject({ status: "saved", notes: null });
    expect((await listJobs(db))[0]?.hasNotes).toBe(false);
  });

  it("refuses to overwrite a note saved elsewhere since the editor loaded it", async () => {
    const { job } = await upsertJob(db, northwind);
    await setJobNotes(db, job.id, "from the phone", null);
    expect(await setJobNotes(db, job.id, "from the laptop", null)).toEqual({ status: "conflict" });
    expect((await getJobDetail(db, job.id))?.job.notes).toBe("from the phone");
    expect(await setJobNotes(db, "missing", "x", null)).toEqual({ status: "not_found" });
  });
});

describe("findJobByUrl", () => {
  const ats = "https://job-boards.greenhouse.io/northwind/jobs/1";

  it("finds a job by LinkedIn id, canonical URL or listing snapshot URL", async () => {
    const { job } = await upsertJob(db, {
      linkedinJobId: "4479142839",
      canonicalUrl: "https://www.linkedin.com/jobs/view/4479142839/",
      ...northwind,
    });
    await addSource(db, { jobId: job.id, kind: "ats", provider: "tavily", url: ats, content: "x" });

    expect((await findJobByUrl(db, { linkedinJobId: "4479142839", urls: [] }))?.id).toBe(job.id);
    expect(
      (await findJobByUrl(db, { urls: ["https://www.linkedin.com/jobs/view/4479142839/"] }))?.id,
    ).toBe(job.id);
    expect((await findJobByUrl(db, { urls: [ats] }))?.id).toBe(job.id);
    expect(await findJobByUrl(db, { linkedinJobId: "1111111111", urls: [] })).toBeUndefined();
  });

  it("matches a snapshot stored with tracking parameters", async () => {
    const { job } = await upsertJob(db, northwind);
    await addSource(db, {
      jobId: job.id,
      kind: "ats",
      provider: "tavily",
      url: `${ats}?gh_src=old`,
      content: "x",
    });
    expect((await findJobByUrl(db, { urls: [ats] }))?.id).toBe(job.id);
    expect((await findJobByUrl(db, { urls: [`${ats}?gh_src=new#apply`] }))?.id).toBe(job.id);
    expect(await findJobByUrl(db, { urls: [`${ats}0`] })).toBeUndefined();
  });

  it("matches a snapshot stored with only a fragment", async () => {
    const { job } = await upsertJob(db, northwind);
    await addSource(db, {
      jobId: job.id,
      kind: "ats",
      provider: "tavily",
      url: `${ats}#apply`,
      content: "x",
    });
    expect((await findJobByUrl(db, { urls: [`${ats}#apply`] }))?.id).toBe(job.id);
    expect((await findJobByUrl(db, { urls: [ats] }))?.id).toBe(job.id);
  });

  it("ignores research pages stored as web sources", async () => {
    const { job } = await upsertJob(db, northwind);
    const about = "https://northwind.example/about";
    await addSource(db, {
      jobId: job.id,
      kind: "web",
      provider: "tavily",
      url: about,
      content: "y",
    });
    expect(await findJobByUrl(db, { urls: [about] })).toBeUndefined();
  });
});

describe("top mark", () => {
  it("marks and unmarks a job without touching its status or list order", async () => {
    const { job } = await upsertJob(db, northwind);
    await setJobStatus(db, job.id, "shortlisted");
    const before = await db.query.jobs.findFirst({ where: eq(jobs.id, job.id) });
    const marked = await setJobTop(db, job.id, true);
    expect(marked?.topAt).toBeInstanceOf(Date);
    expect(marked).toMatchObject({ status: "shortlisted", updatedAt: before?.updatedAt });
    expect(marked?.progressedAt).toEqual(before?.progressedAt);
    expect((await setJobTop(db, job.id, true))?.topAt).toEqual(marked?.topAt);
    expect((await listJobs(db))[0]?.topAt).toEqual(marked?.topAt);
    expect((await setJobTop(db, job.id, false))?.topAt).toBeNull();
    expect(await setJobTop(db, "missing", true)).toBeUndefined();
  });
});
