import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db, migrateDb, upsertJob } from "@copilot/db";
import { beforeEach, describe, expect, it } from "vitest";
import { updateJobStatus } from "./job-status";
import { findSavedJobs } from "./profile";

let db: Db;

beforeEach(async () => {
  db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "job-status-")), "t.db")}`);
  await migrateDb(db);
});

const job = async (company: string, title: string) =>
  (await upsertJob(db, { company, title })).job.id;

describe("set_job_status", () => {
  it("updates the status and reports archiving", async () => {
    const id = await job("Acme", "Platform Engineer");
    expect(await updateJobStatus(db, id, "applied")).toMatchObject({
      ok: true,
      status: "applied",
      archived: false,
    });
    expect(await updateJobStatus(db, id, "dismissed")).toMatchObject({ archived: true });
    expect(await updateJobStatus(db, "nope", "applied")).toMatchObject({ ok: false });
  });
});

describe("find_saved_jobs", () => {
  it("filters by status and hides archived jobs unless asked", async () => {
    const applied = await job("Acme", "Platform Engineer");
    const dismissed = await job("Contoso", "Platform Engineer");
    await job("Northwind", "SRE");
    await updateJobStatus(db, applied, "applied");
    await updateJobStatus(db, dismissed, "dismissed");

    const ids = (r: Awaited<ReturnType<typeof findSavedJobs>>) => r.matches.map((m) => m.jobId);
    expect(ids(await findSavedJobs(db, { status: "applied" }))).toEqual([applied]);
    expect(ids(await findSavedJobs(db, { query: "platform" }))).toEqual([applied]);
    expect(
      ids(await findSavedJobs(db, { query: "platform", includeArchived: true })).sort(),
    ).toEqual([applied, dismissed].sort());
    // Asking for a closing status includes archived jobs.
    expect(ids(await findSavedJobs(db, { status: "dismissed" }))).toEqual([dismissed]);
  });
});
