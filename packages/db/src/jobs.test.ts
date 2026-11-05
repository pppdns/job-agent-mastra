import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { listJobs } from "./assessments";
import { createDb, type Db, migrateDb } from "./index";
import {
  addSource,
  dedupeKey,
  findJobByUrl,
  latestListingSource,
  MAX_SNAPSHOT_CHARS,
  setJobArchived,
  setJobStatus,
  upsertJob,
} from "./jobs";

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
