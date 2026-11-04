import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db, migrateDb, upsertJob } from "@copilot/db";
import type { MastraDBMessage } from "@mastra/core/agent/message-list";
import { beforeEach, describe, expect, it } from "vitest";
import { statusChangeRefusal, updateJobStatus } from "./job-status";
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

const user = (text: string) =>
  ({
    id: text,
    role: "user",
    createdAt: new Date(),
    content: { format: 2, parts: [{ type: "text", text }] },
  }) as MastraDBMessage;
const toolCall = (toolName: string, args: unknown = {}) =>
  ({
    id: toolName,
    role: "assistant",
    createdAt: new Date(),
    content: {
      format: 2,
      parts: [
        {
          type: "tool-invocation",
          toolInvocation: { state: "result", toolCallId: toolName, toolName, args, result: {} },
        },
      ],
    },
  }) as MastraDBMessage;

describe("statusChangeRefusal", () => {
  it("allows a short user request that names the status", () => {
    expect(statusChangeRefusal([user("I applied to Acme today, mark it")], "applied")).toBeNull();
    expect(statusChangeRefusal([user("Not interested in Contoso")], "dismissed")).toBeNull();
    expect(
      statusChangeRefusal([user("I applied"), toolCall("find_saved_jobs")], "applied"),
    ).toBeNull();
  });

  it("refuses a status the user didn't ask for", () => {
    expect(statusChangeRefusal([user("What do you think of Acme?")], "applied")).toMatch(
      /doesn't ask for "applied"/,
    );
    expect(statusChangeRefusal([], "applied")).toMatch(/no user request/);
  });

  it("refuses after listing or web text was read in this turn", () => {
    for (const call of [
      toolCall("ingest_listing"),
      toolCall("research_company"),
      toolCall("get_job", { includeListing: true }),
    ]) {
      expect(statusChangeRefusal([user("Assess this, I applied"), call], "applied")).toMatch(
        /read in this turn/,
      );
    }
    // Reads from earlier turns don't count; the newest user message starts the turn.
    expect(
      statusChangeRefusal([user("x"), toolCall("ingest_listing"), user("I applied")], "applied"),
    ).toBeNull();
  });

  it("refuses pasted content", () => {
    expect(statusChangeRefusal([user(`I applied. ${"x".repeat(1_000)}`)], "applied")).toMatch(
      /pasted content/,
    );
  });
});

describe("find_saved_jobs limits", () => {
  it("returns eligible text matches even when better-ranked ones are archived", async () => {
    const archived = [];
    for (let i = 0; i < 6; i++) archived.push(await job(`Acme ${i}`, "Platform Engineer"));
    for (const id of archived) await updateJobStatus(db, id, "dismissed");
    const active = await job("Acme 9", "Platform Engineer");
    const result = await findSavedJobs(db, { query: "acme platform" });
    expect(result.matches.map((m) => m.jobId)).toEqual([active]);
  });
});
