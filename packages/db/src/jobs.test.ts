import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db, migrateDb } from "./index";
import { addSource, dedupeKey, latestListingSource, MAX_SNAPSHOT_CHARS, upsertJob } from "./jobs";

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
