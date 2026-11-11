import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addSource,
  createDb,
  type Db,
  decideApproval,
  getJobDetail,
  listJobs,
  migrateDb,
  proposeProfileChange,
  saveDraft,
  setJobStatus,
  upsertJob,
} from "@copilot/db";
import { beforeEach, describe, expect, it } from "vitest";
import { clipHeadline, type RescoreEvent, runRescore } from "./run";

// Mock model (LLM_MODE=mock): answers structured output with a with_profile assessment.
let db: Db;
let events: RescoreEvent[];

const deps = (over = {}) => ({
  db,
  emit: async (e: RescoreEvent) => {
    events.push(e);
  },
  ...over,
});

async function savedJob(title: string, withListing = true) {
  const { job } = await upsertJob(db, { company: "Northwind Robotics", title });
  const content = withListing ? `# ${title}\n\nBuild the platform.` : "x";
  const { source } = await addSource(db, {
    jobId: job.id,
    kind: "pasted",
    provider: "user",
    content,
  });
  await saveDraft(db, {
    jobId: job.id,
    assessment: {
      overview: "Old",
      fitBasis: "role_only",
      strengths: [{ text: "Listing read", evidence: "official", sourceIds: [source.id] }],
      recommendation: { verdict: "investigate_further", rationale: "Old." },
    },
  });
  return job.id;
}

async function approveProfileFact(text: string) {
  const { approval } = await proposeProfileChange(db, {
    threadId: "chat-a",
    proposal: { changes: [{ op: "add", kind: "hard_requirement", text }], reason: "User said so" },
  });
  await decideApproval(db, {
    approvalId: approval.id,
    threadId: "chat-a",
    decision: "approve",
    payloadHash: approval.payloadHash,
  });
}

beforeEach(async () => {
  db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "rescore-")), "t.db")}`);
  await migrateDb(db);
  events = [];
});

describe("runRescore", () => {
  it("re-scores only stale jobs, one draft each, against the current profile", async () => {
    const a = await savedJob("Platform Engineer");
    const b = await savedJob("SRE");
    await approveProfileFact("Remote only");
    const fresh = await savedJob("Data Engineer"); // assessed under the current profile

    const result = await runRescore({}, deps({ threadId: "chat-b" }));
    expect(result.status).toBe("completed");
    expect(result.results.map((r) => r.jobId).sort()).toEqual([a, b].sort());
    expect(result.results.every((r) => r.status === "saved")).toBe(true);
    expect(result.results[0]).toMatchObject({
      before: { verdict: "investigate_further" },
      after: { verdict: "pursue", fitLevel: "good" },
    });
    const stale = (await listJobs(db)).filter((j) => j.profileStale).map((j) => j.id);
    expect(stale).toEqual([]);
    expect((await getJobDetail(db, fresh))?.draft?.version).toBe(1);
    expect(events.map((e) => e.kind)).toEqual(["start", "job", "job", "done"]);
  });

  it("skips archived jobs unless asked for by id", async () => {
    const active = await savedJob("Platform Engineer");
    const dismissed = await savedJob("SRE");
    await setJobStatus(db, dismissed, "dismissed");
    await approveProfileFact("Remote only");

    const result = await runRescore({}, deps({ threadId: "chat-b" }));
    expect(result.results.map((r) => r.jobId)).toEqual([active]);
    const byId = await runRescore({ jobIds: [dismissed] }, deps({ threadId: "chat-b" }));
    expect(byId.results.map((r) => r.jobId)).toEqual([dismissed]);
  });

  it("re-scores every active assessed job with all, stale ones first", async () => {
    const stale = await savedJob("Platform Engineer");
    await approveProfileFact("Remote only");
    const fresh = await savedJob("Data Engineer");
    const dismissed = await savedJob("SRE");
    await setJobStatus(db, dismissed, "dismissed");

    const result = await runRescore({ all: true }, deps());
    expect(events[0]).toMatchObject({ kind: "start", total: 2, skipped: 0 });
    expect(result.results.map((r) => r.jobId).sort()).toEqual([stale, fresh].sort());
    expect((await getJobDetail(db, fresh))?.draft?.version).toBe(2);
    expect((await getJobDetail(db, dismissed))?.draft?.version).toBe(1);
  });

  it("reports a job without a stored listing as failed and keeps going", async () => {
    const { job } = await upsertJob(db, { company: "Contoso", title: "SRE" });
    await saveDraft(db, {
      jobId: job.id,
      assessment: {
        overview: "No source",
        fitBasis: "role_only",
        recommendation: { verdict: "investigate_further", rationale: "x" },
      },
    });
    const ok = await savedJob("Platform Engineer");
    await approveProfileFact("Remote only");

    const result = await runRescore({}, deps());
    const byJob = Object.fromEntries(result.results.map((r) => [r.jobId, r.status]));
    expect(byJob).toEqual({ [job.id]: "failed", [ok]: "saved" });
  });

  it("saves nothing once the parent run is stopped", async () => {
    await savedJob("Platform Engineer");
    await approveProfileFact("Remote only");
    const controller = new AbortController();
    controller.abort();
    const result = await runRescore({}, deps({ signal: controller.signal }));
    expect(result).toMatchObject({ status: "cancelled", results: [] });
  });
});

describe("clipHeadline", () => {
  it("keeps short headlines and cuts long ones at a word boundary", () => {
    expect(clipHeadline(undefined)).toBeUndefined();
    expect(clipHeadline("Remote platform role; pay meets the floor")).toBe(
      "Remote platform role; pay meets the floor",
    );
    const long = `Senior platform role, ${"fully remote within the EU ".repeat(6)}and pay meets the floor`;
    const clipped = clipHeadline(long) ?? "";
    expect(clipped.length).toBeLessThanOrEqual(140);
    expect(clipped.endsWith("…")).toBe(true);
    expect(long.startsWith(clipped.slice(0, -1))).toBe(true);
    expect(clipped.at(-2)).not.toBe(" ");
  });
});
