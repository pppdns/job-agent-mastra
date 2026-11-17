import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SEARCH_SETTINGS, type PostingInput, screenPosting } from "@copilot/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordPosting, saveTriage } from "./discovery";
import { createDb, type Db, migrateDb } from "./index";
import { addSource, setJobStatus, upsertJob } from "./jobs";
import { dismissClosedListing, jobsToCheckListings, markListingsChecked } from "./listings";
import { jobs } from "./schema";

let db: Db;
beforeEach(async () => {
  db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "listings-")), "test.db")}`);
  await migrateDb(db);
});

const now = new Date("2026-11-10T12:00:00Z");
const settings = { ...DEFAULT_SEARCH_SETTINGS, triageThreshold: 60, digestThreshold: 75 };

const posting = (n: number, over: Partial<PostingInput> = {}): PostingInput => ({
  source: "linkedin",
  externalId: `44800000${n}`,
  url: `https://www.linkedin.com/jobs/view/44800000${n}/`,
  applyUrl: `https://job-boards.greenhouse.io/acme/jobs/${n}000`,
  title: `Engineer ${n}`,
  company: `Acme ${n}`,
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
  postedAt: new Date("2026-11-08T00:00:00Z"),
  description: "Build things.",
  ...over,
});

/** A discovered job with a triage score. */
async function discovered(n: number, score: number) {
  const p = posting(n);
  await recordPosting(db, {
    posting: p,
    screen: screenPosting(DEFAULT_SEARCH_SETTINGS, p, now),
    runId: "run-1",
    now,
  });
  const job = await db.query.jobs.findFirst({ where: eq(jobs.title, p.title) });
  if (!job) throw new Error("job not recorded");
  await saveTriage(db, job.id, { score, reason: "r", profileVersion: 1 });
  return job.id;
}

const ids = async () => (await jobsToCheckListings(db, settings)).map((j) => j.id).sort();

describe("jobsToCheckListings", () => {
  it("picks shortlisted jobs and new ones at the digest threshold, never applied ones", async () => {
    const high = await discovered(1, 80);
    const low = await discovered(2, 65);
    const shortlistedLow = await discovered(3, 40);
    await setJobStatus(db, shortlistedLow, "shortlisted");
    const applied = await discovered(4, 90);
    await setJobStatus(db, applied, "applied");
    const dismissed = await discovered(5, 90);
    await setJobStatus(db, dismissed, "dismissed");
    const { job: chat } = await upsertJob(db, { canonicalUrl: "https://jobs.lever.co/x/1" });

    expect(await ids()).toEqual([high, shortlistedLow, chat.id].sort());
    expect(await ids()).not.toContain(low);
  });

  it("lists every listing link of a job, deduplicated", async () => {
    const id = await discovered(1, 80);
    await addSource(db, {
      jobId: id,
      kind: "ats",
      provider: "tavily",
      url: "https://job-boards.greenhouse.io/acme/jobs/1000",
      content: "x",
    });
    const [job] = await jobsToCheckListings(db, settings);
    expect(job?.urls).toEqual(
      expect.arrayContaining([
        "https://www.linkedin.com/jobs/view/448000001/",
        "https://job-boards.greenhouse.io/acme/jobs/1000",
      ]),
    );
    expect(new Set(job?.urls).size).toBe(job?.urls.length);
  });

  it("checks the least recently checked jobs first", async () => {
    const a = await discovered(1, 80);
    const b = await discovered(2, 80);
    await markListingsChecked(db, [a], now);
    expect((await jobsToCheckListings(db, settings)).map((j) => j.id)).toEqual([b, a]);
  });
});

describe("dismissClosedListing", () => {
  const evidence = {
    url: "https://www.linkedin.com/jobs/view/448000001/",
    site: "linkedin",
    signal: "LinkedIn: No longer accepting applications",
  };

  it("dismisses and archives a shortlisted job and records why", async () => {
    const id = await discovered(1, 80);
    await setJobStatus(db, id, "shortlisted");
    const job = await dismissClosedListing(db, id, evidence, now);
    expect(job).toMatchObject({ status: "dismissed", archivedAt: now, listingClosedAt: now });
    expect(job?.listingClosed).toEqual({ ...evidence, previousStatus: "shortlisted" });
  });

  it.each(["applied", "interviewing", "offer", "rejected", "dismissed"] as const)(
    "never touches a %s job",
    async (status) => {
      const id = await discovered(1, 80);
      await setJobStatus(db, id, status);
      expect(await dismissClosedListing(db, id, evidence, now)).toBeUndefined();
      const job = await db.query.jobs.findFirst({ where: eq(jobs.id, id) });
      expect(job).toMatchObject({ status, listingClosedAt: null });
    },
  );

  it("is not checked again once the user restores it", async () => {
    const id = await discovered(1, 80);
    await dismissClosedListing(db, id, evidence, now);
    await setJobStatus(db, id, "new");
    expect(await ids()).toEqual([]);
  });
});
