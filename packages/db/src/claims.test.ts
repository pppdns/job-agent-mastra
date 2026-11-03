import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { listClaims, recordClaim } from "./claims";
import { AssessmentError } from "./hash";
import { createDb, type Db, migrateDb } from "./index";
import { addSource, upsertJob } from "./jobs";

let db: Db;
let jobId: string;
let sourceId: string;

beforeEach(async () => {
  db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "claims-")), "test.db")}`);
  await migrateDb(db);
  jobId = (await upsertJob(db, { company: "Acme", title: "Engineer" })).job.id;
  sourceId = (
    await addSource(db, {
      jobId,
      kind: "web",
      provider: "tavily",
      url: "https://a.example",
      content: "x",
    })
  ).source.id;
});

const claim = (over: object = {}) => ({
  topic: "business_health",
  text: "Raised a Series B round.",
  evidence: "independent",
  sourceIds: [sourceId],
  publishedAt: "2026-05-02",
  eventDate: "2026-04",
  ...over,
});

describe("recordClaim", () => {
  it("stores claims per run with separate publication and event dates", async () => {
    await recordClaim(db, { jobId, runId: "r1", claim: claim() });
    await recordClaim(db, {
      jobId,
      runId: "r2",
      claim: claim({ evidence: "inference", sourceIds: [] }),
    });
    expect(await listClaims(db, { runId: "r1" })).toMatchObject([
      { publishedAt: "2026-05-02", eventDate: "2026-04", sourceIds: [sourceId] },
    ]);
    expect(await listClaims(db, { jobId })).toHaveLength(2);
  });

  it("rejects sourced classes without sources, foreign sources and bad dates", async () => {
    await expect(
      recordClaim(db, { jobId, runId: "r", claim: claim({ sourceIds: [] }) }),
    ).rejects.toThrow(AssessmentError);
    await expect(
      recordClaim(db, { jobId, runId: "r", claim: claim({ sourceIds: ["other"] }) }),
    ).rejects.toThrow(/not read for this job/);
    await expect(
      recordClaim(db, { jobId, runId: "r", claim: claim({ publishedAt: "May 2026" }) }),
    ).rejects.toThrow(/invalid claim/);
  });
});
