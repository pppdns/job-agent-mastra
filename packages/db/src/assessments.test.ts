import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  approveDrafts,
  approvedDraftIds,
  decideApproval,
  getJobDetail,
  listJobs,
  proposeSnapshot,
  saveDraft,
  snapshotPayloadOf,
} from "./assessments";
import { AssessmentError, hashPayload } from "./hash";
import { createDb, type Db, migrateDb } from "./index";
import { addSource, upsertJob } from "./jobs";
import { currentProfile, proposeProfileChange } from "./profile";
import { jobSnapshots } from "./schema";

let db: Db;
let jobId: string;
let sourceId: string;

const assessment = (overview = "Platform role at a robotics company.", source = sourceId) => ({
  overview,
  fitBasis: "role_only",
  strengths: [{ text: "Clear platform ownership", evidence: "official", sourceIds: [source] }],
  unknowns: [{ question: "Salary?", whyItMatters: "Not stated in the listing" }],
  recommendation: { verdict: "investigate_further", rationale: "Pay and on-call unknown." },
});

beforeEach(async () => {
  db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "assess-")), "test.db")}`);
  await migrateDb(db);
  const { job } = await upsertJob(db, {
    company: "Northwind Robotics",
    title: "Platform Engineer",
  });
  jobId = job.id;
  sourceId = (
    await addSource(db, { jobId, kind: "pasted", provider: "user", content: "listing text" })
  ).source.id;
});

/** Approves one hard requirement and returns its fact id. */
async function approvedFact(): Promise<string> {
  const { approval } = await proposeProfileChange(db, {
    threadId: "seed",
    proposal: {
      changes: [{ op: "add", kind: "hard_requirement", text: "At most one office day a week" }],
      reason: "User said so",
    },
  });
  await decideApproval(db, {
    approvalId: approval.id,
    threadId: "seed",
    decision: "approve",
    payloadHash: approval.payloadHash,
  });
  const fact = (await currentProfile(db)).facts[0];
  if (!fact) throw new Error("fact not applied");
  return fact.id;
}

const fitPoint = (factId: string) => ({
  text: "Three office days a week conflicts with at most one",
  evidence: "inference",
  sourceIds: [sourceId],
  quote: "three days a week in our Lisbon office",
  profileFactIds: [factId],
});

const snapshots = () => db.select().from(jobSnapshots).where(eq(jobSnapshots.jobId, jobId));

async function proposed(threadId = "thread-a") {
  await saveDraft(db, { jobId, assessment: assessment(), threadId });
  return (await proposeSnapshot(db, { jobId, threadId })).approval;
}

const approve = (approval: { id: string; payloadHash: string }, threadId = "thread-a") =>
  decideApproval(db, {
    approvalId: approval.id,
    threadId,
    decision: "approve",
    payloadHash: approval.payloadHash,
  });

describe("saveDraft", () => {
  it("adds a new version on every save", async () => {
    const v1 = await saveDraft(db, { jobId, assessment: assessment() });
    const v2 = await saveDraft(db, { jobId, assessment: assessment("Revised") });
    expect([v1.version, v2.version]).toEqual([1, 2]);
  });

  it("rejects evidence citing a source of another job", async () => {
    const other = await upsertJob(db, { company: "Other", title: "Role" });
    const foreign = (
      await addSource(db, { jobId: other.job.id, kind: "pasted", provider: "user", content: "x" })
    ).source.id;
    await expect(saveDraft(db, { jobId, assessment: assessment("x", foreign) })).rejects.toThrow(
      AssessmentError,
    );
  });

  it("allows a fit level only when the profile informed the assessment", async () => {
    await expect(
      saveDraft(db, { jobId, assessment: { ...assessment(), fitLevel: "good" } }),
    ).rejects.toThrow(/needs fitBasis with_profile/);
    await expect(
      saveDraft(db, { jobId, assessment: { ...assessment(), fitBasis: "with_profile" } }),
    ).rejects.toThrow(/needs a fitLevel/);
    const factId = await approvedFact();
    await expect(
      saveDraft(db, {
        jobId,
        assessment: {
          ...assessment(),
          fitBasis: "with_profile",
          fitLevel: "good",
          strengths: [fitPoint(factId)],
        },
      }),
    ).resolves.toMatchObject({ version: 1 });
  });

  it("makes fit points cite current profile facts as inference, only with the profile", async () => {
    const factId = await approvedFact();
    const withProfile = (strengths: unknown[]) => ({
      ...assessment(),
      fitBasis: "with_profile",
      fitLevel: "good",
      strengths,
    });
    // No fit point at all: the profile can't have informed it.
    await expect(saveDraft(db, { jobId, assessment: withProfile([]) })).rejects.toThrow(
      /at least one point that cites the profile/,
    );
    // A comparison with the profile labelled as listing fact.
    await expect(
      saveDraft(db, {
        jobId,
        assessment: withProfile([{ ...fitPoint(factId), evidence: "official" }]),
      }),
    ).rejects.toThrow(/compares the job with the profile, so its evidence is inference/);
    await expect(
      saveDraft(db, { jobId, assessment: withProfile([fitPoint("not-a-fact")]) }),
    ).rejects.toThrow(/not in the approved profile/);
    await expect(
      saveDraft(db, { jobId, assessment: { ...assessment(), strengths: [fitPoint(factId)] } }),
    ).rejects.toThrow(/role_only drafts can't cite profileFactIds/);
    // The prompt's "[fact:<id>]" form is accepted and stored as the bare id.
    const prefixed = await saveDraft(db, {
      jobId,
      assessment: withProfile([fitPoint(`fact:${factId}`)]),
    });
    expect(prefixed.assessment.strengths[0]?.profileFactIds).toEqual([factId]);
    // Listing sources and quotes stay allowed on a fit point.
    await expect(
      saveDraft(db, { jobId, assessment: withProfile([fitPoint(factId)]) }),
    ).resolves.toMatchObject({ version: 2 });
  });

  it("requires a source for listing/official evidence but not for inference", async () => {
    const unsourced = {
      ...assessment(),
      strengths: [{ text: "Great culture", evidence: "official", sourceIds: [] }],
    };
    await expect(saveDraft(db, { jobId, assessment: unsourced })).rejects.toThrow(
      /cites no source/,
    );
    const inferred = {
      ...unsourced,
      strengths: [{ text: "Probably modern stack", evidence: "inference", sourceIds: [] }],
    };
    await expect(saveDraft(db, { jobId, assessment: inferred })).resolves.toMatchObject({
      version: 1,
    });
  });

  it("rejects unknown jobs and invalid assessments", async () => {
    await expect(saveDraft(db, { jobId: "nope", assessment: assessment() })).rejects.toThrow(
      /unknown job/,
    );
    await expect(saveDraft(db, { jobId, assessment: { overview: "x" } })).rejects.toThrow(
      /invalid assessment/,
    );
  });
});

describe("proposeSnapshot", () => {
  it("needs a draft", async () => {
    await expect(proposeSnapshot(db, { jobId, threadId: "t" })).rejects.toThrow(/no draft/);
  });

  it("is idempotent per draft and chat", async () => {
    const first = await proposed();
    const again = await proposeSnapshot(db, { jobId, threadId: "thread-a" });
    expect(again).toMatchObject({ created: false, approval: { id: first.id } });
  });

  it("binds the hash to the exact payload", async () => {
    const approval = await proposed();
    expect(approval.payloadHash).toBe(hashPayload(approval.payload));
    expect(snapshotPayloadOf(approval).assessment.overview).toBe(
      "Platform role at a robotics company.",
    );
  });

  it("supersedes an older pending proposal for the same job", async () => {
    const old = await proposed();
    await saveDraft(db, { jobId, assessment: assessment("Revised") });
    const fresh = (await proposeSnapshot(db, { jobId, threadId: "thread-a" })).approval;
    expect(fresh.draftVersion).toBe(2);
    expect(await approve(old)).toMatchObject({ ok: false, error: "superseded" });
    expect(await snapshots()).toHaveLength(0);
  });
});

describe("decideApproval", () => {
  it("approving creates snapshot v1 with the approved payload", async () => {
    const approval = await proposed();
    const result = await approve(approval);
    expect(result).toMatchObject({ ok: true, approval: { status: "approved" } });
    if (result.ok) {
      expect(result.snapshot).toMatchObject({ version: 1, payloadHash: approval.payloadHash });
      expect(result.approval.snapshotId).toBe(result.snapshot?.id);
    }
  });

  it("returns the same result for a retried approval (lost response) without a second snapshot", async () => {
    const approval = await proposed();
    const first = await approve(approval);
    const retry = await approve(approval);
    expect(retry).toMatchObject({ ok: true });
    if (first.ok && retry.ok) expect(retry.snapshot?.id).toBe(first.snapshot?.id);
    expect(await snapshots()).toHaveLength(1);
  });

  it("lets only one of two concurrent approvals create a snapshot", async () => {
    const approval = await proposed();
    const results = await Promise.all([approve(approval), approve(approval)]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await snapshots()).toHaveLength(1);
  });

  it("rejects a decision from another chat", async () => {
    const approval = await proposed("thread-a");
    expect(await approve(approval, "thread-b")).toEqual({ ok: false, error: "wrong_thread" });
    expect(await snapshots()).toHaveLength(0);
  });

  it("rejects a decision on a payload the user didn't see", async () => {
    const approval = await proposed();
    const result = await approve({ id: approval.id, payloadHash: "0".repeat(64) });
    expect(result).toMatchObject({ ok: false, error: "stale" });
    expect(await snapshots()).toHaveLength(0);
  });

  it("marks the approval stale when a newer draft exists", async () => {
    const approval = await proposed();
    await saveDraft(db, { jobId, assessment: assessment("Changed after proposal") });
    expect(await approve(approval)).toMatchObject({
      ok: false,
      error: "stale",
      approval: { status: "stale" },
    });
    expect(await snapshots()).toHaveLength(0);
  });

  it("does not approve after a rejection", async () => {
    const approval = await proposed();
    const reject = await decideApproval(db, {
      approvalId: approval.id,
      threadId: "thread-a",
      decision: "reject",
      payloadHash: approval.payloadHash,
    });
    expect(reject).toMatchObject({ ok: true, approval: { status: "rejected" } });
    expect(await approve(approval)).toMatchObject({ ok: false, error: "already_resolved" });
  });

  it("returns not_found for unknown approvals", async () => {
    expect(await approve({ id: "missing", payloadHash: "x" })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("keeps earlier snapshots when a revised draft is approved", async () => {
    await approve(await proposed());
    await saveDraft(db, { jobId, assessment: assessment("Revised after research") });
    const second = (await proposeSnapshot(db, { jobId, threadId: "thread-a" })).approval;
    await approve(second);
    const versions = (await snapshots()).map((s) => [s.version, s.payload.assessment.overview]);
    expect(versions).toEqual([
      [1, "Platform role at a robotics company."],
      [2, "Revised after research"],
    ]);
  });
});

describe("read models", () => {
  it("lists jobs with draft, approved and pending state", async () => {
    const pending = await proposed();
    expect(await listJobs(db)).toMatchObject([
      { id: jobId, draftVersion: 1, approvedVersion: null, pendingApproval: true },
    ]);
    const detail = await getJobDetail(db, jobId);
    expect(detail).toMatchObject({
      draft: { version: 1 },
      snapshots: [],
      sources: [{ kind: "pasted" }],
    });
    await approve(pending);
    await saveDraft(db, { jobId, assessment: assessment("Revised") });
    expect(await listJobs(db)).toMatchObject([
      { draftVersion: 2, approvedVersion: 1, approvedDraftVersion: 1, pendingApproval: false },
    ]);
  });
});

describe("saveDraft profile check", () => {
  it("rejects an assessment made against an older profile version", async () => {
    await expect(
      saveDraft(db, { jobId, assessment: assessment(), profileVersion: 0 }),
    ).resolves.toMatchObject({ profileVersion: 0 });
    const { approval } = await proposeProfileChange(db, {
      threadId: "chat-a",
      proposal: {
        changes: [{ op: "add", kind: "soft_preference", text: "Remote" }],
        reason: "User said so",
      },
    });
    await decideApproval(db, {
      approvalId: approval.id,
      threadId: "chat-a",
      decision: "approve",
      payloadHash: approval.payloadHash,
    });
    await expect(
      saveDraft(db, { jobId, assessment: assessment(), profileVersion: 0 }),
    ).rejects.toThrow(/profile changed/);
  });
});

describe("approveDrafts", () => {
  it("approves the shown drafts and skips one that changed since", async () => {
    const other = (await upsertJob(db, { company: "Contoso", title: "SRE" })).job.id;
    const otherSource = (
      await addSource(db, { jobId: other, kind: "pasted", provider: "user", content: "sre" })
    ).source.id;
    const shown = await saveDraft(db, { jobId, assessment: assessment() });
    const outdated = await saveDraft(db, {
      jobId: other,
      assessment: assessment("a", otherSource),
    });
    await saveDraft(db, { jobId: other, assessment: assessment("newer", otherSource) });

    const results = await approveDrafts(db, {
      threadId: "chat-a",
      draftIds: [shown.id, outdated.id, "missing"],
    });
    expect(results.map((r) => r.outcome)).toEqual(["approved", "changed", "not_found"]);
    expect((await getJobDetail(db, jobId))?.snapshots).toHaveLength(1);
    expect((await getJobDetail(db, other))?.snapshots).toHaveLength(0);
    // A retried click approves nothing twice.
    expect(
      (await approveDrafts(db, { threadId: "chat-a", draftIds: [shown.id] }))[0],
    ).toMatchObject({
      outcome: "approved",
    });
    expect((await getJobDetail(db, jobId))?.snapshots).toHaveLength(1);
    expect(await approvedDraftIds(db, [shown.id, outdated.id])).toEqual([shown.id]);
  });
});
