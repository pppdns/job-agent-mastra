import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getJobDetail, listJobs, saveDraft } from "./assessments";
import { AssessmentError } from "./hash";
import { createDb, type Db, migrateDb } from "./index";
import { addSource, ftsQuery, searchJobIds, upsertJob } from "./jobs";
import {
  currentProfile,
  decideApproval,
  editProfile,
  pendingApprovalsForThread,
  profileHistory,
  proposeProfileChange,
} from "./profile";
import type { Approval } from "./schema";

let db: Db;

beforeEach(async () => {
  db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "profile-")), "test.db")}`);
  await migrateDb(db);
});

const propose = (changes: unknown[], threadId = "chat-a") =>
  proposeProfileChange(db, { threadId, proposal: { changes, reason: "User said so" } });

const decide = (
  approval: Approval,
  decision: "approve" | "reject" = "approve",
  threadId = "chat-a",
) =>
  decideApproval(db, {
    approvalId: approval.id,
    threadId,
    decision,
    payloadHash: approval.payloadHash,
  });

async function approvedFact(text: string, kind = "soft_preference") {
  const { approval } = await propose([{ op: "add", kind, text }]);
  await decide(approval);
  const fact = (await currentProfile(db)).facts.find((f) => f.text === text);
  if (!fact) throw new Error("fact not applied");
  return fact;
}

describe("profile changes", () => {
  it("starts empty at version 0", async () => {
    expect(await currentProfile(db)).toEqual({ version: 0, facts: [] });
  });

  it("changes nothing until the user approves", async () => {
    const { approval } = await propose([
      { op: "add", kind: "hard_requirement", text: "Remote only" },
    ]);
    expect(approval.status).toBe("pending");
    expect((await currentProfile(db)).facts).toEqual([]);

    expect(await decide(approval)).toMatchObject({ ok: true, approval: { profileVersion: 1 } });
    expect(await currentProfile(db)).toMatchObject({
      version: 1,
      facts: [{ kind: "hard_requirement", text: "Remote only", createdInVersion: 1 }],
    });
  });

  it("modifies by superseding, keeping the old fact as history", async () => {
    const fact = await approvedFact("Prefers Budapest");
    const { approval } = await propose([
      { op: "modify", factId: fact.id, text: "Open to relocating to London" },
    ]);
    expect(approval.payload).toMatchObject({
      baseVersion: 1,
      changes: [
        {
          op: "modify",
          before: { text: "Prefers Budapest" },
          text: "Open to relocating to London",
        },
      ],
    });
    await decide(approval);
    const { version, facts } = await currentProfile(db);
    expect(version).toBe(2);
    expect(facts).toMatchObject([{ text: "Open to relocating to London", supersedesId: fact.id }]);
    expect((await profileHistory(db)).map((h) => h.version)).toEqual([2, 1]);
  });

  it("removes facts", async () => {
    const fact = await approvedFact("Dislikes on-call");
    await decide((await propose([{ op: "remove", factId: fact.id }])).approval);
    expect((await currentProfile(db)).facts).toEqual([]);
  });

  it("gives every new fact the next handle, never reusing one, and accepts handles", async () => {
    const first = await approvedFact("Prefers Budapest");
    expect(first.handle).toBe(1);
    // Modify by handle (as models cite it): the new fact gets handle 2, f1 stays history.
    await decide(
      (await propose([{ op: "modify", factId: "fact:f1", text: "Prefers Vienna" }])).approval,
    );
    const [modified] = (await currentProfile(db)).facts;
    expect(modified).toMatchObject({ handle: 2, text: "Prefers Vienna", supersedesId: first.id });
    await expect(propose([{ op: "remove", factId: "f1" }])).rejects.toThrow(
      'current facts: f2 ("Prefers Vienna")',
    );
    await decide((await propose([{ op: "remove", factId: "f2" }])).approval);
    expect((await approvedFact("Small teams")).handle).toBe(3);
  });

  it("rejects changes to facts that are not current", async () => {
    await expect(propose([{ op: "remove", factId: "invented" }])).rejects.toThrow(AssessmentError);
  });

  it("marks a proposal stale when the profile changed after it was made", async () => {
    const first = (await propose([{ op: "add", kind: "background", text: "Ten years of Go" }]))
      .approval;
    const second = (await propose([{ op: "add", kind: "background", text: "Speaks Hungarian" }]))
      .approval;
    await decide(first);
    expect(await decide(second)).toMatchObject({
      ok: false,
      error: "stale",
      approval: { status: "stale" },
    });
    expect(await currentProfile(db)).toMatchObject({
      version: 1,
      facts: [{ text: "Ten years of Go" }],
    });
  });

  it("is idempotent for the same proposal in the same chat, and decisions are chat-bound", async () => {
    const change = [{ op: "add", kind: "soft_preference", text: "Small teams" }];
    const a = await propose(change);
    expect(await propose(change)).toMatchObject({
      created: false,
      approval: { id: a.approval.id },
    });
    expect(await decide(a.approval, "approve", "chat-b")).toEqual({
      ok: false,
      error: "wrong_thread",
    });
    expect(await decide(a.approval)).toMatchObject({ ok: true });
    expect(await decide(a.approval)).toMatchObject({ ok: true, approval: { profileVersion: 1 } });
    expect((await currentProfile(db)).facts).toHaveLength(1);
  });

  it("leaves the profile unchanged on rejection", async () => {
    const { approval } = await propose([
      { op: "add", kind: "soft_preference", text: "Hypothetical" },
    ]);
    expect(await decide(approval, "reject")).toMatchObject({
      ok: true,
      approval: { status: "rejected" },
    });
    expect(await currentProfile(db)).toEqual({ version: 0, facts: [] });
  });
});

describe("profile page edits", () => {
  const edit = (changes: unknown[], baseVersion: number) =>
    editProfile(db, {
      threadId: "profile-page",
      baseVersion,
      proposal: { changes, reason: "Edited on the profile page" },
    });

  it("applies right away as a new version, recorded in history", async () => {
    const { version } = await edit([{ op: "add", kind: "background", text: "Ten years of Go" }], 0);
    expect(version).toBe(1);
    expect(await currentProfile(db)).toMatchObject({
      version: 1,
      facts: [{ text: "Ten years of Go" }],
    });
    expect(await profileHistory(db)).toMatchObject([
      { version: 1, change: { changes: [{ op: "add", text: "Ten years of Go" }] } },
    ]);
    expect(await pendingApprovalsForThread(db, "profile-page")).toEqual([]);
  });

  it("refuses an edit made against an older profile version", async () => {
    await edit([{ op: "add", kind: "background", text: "Writes Go" }], 0);
    await expect(edit([{ op: "add", kind: "background", text: "Writes Rust" }], 0)).rejects.toThrow(
      /profile changed/,
    );
    expect((await currentProfile(db)).facts).toHaveLength(1);
  });

  it("makes a pending chat proposal from before the edit stale", async () => {
    const { approval } = await propose([{ op: "add", kind: "soft_preference", text: "Remote" }]);
    await edit([{ op: "add", kind: "background", text: "Writes Go" }], 0);
    expect(await decide(approval)).toMatchObject({ ok: false, error: "stale" });
  });
});

describe("drafts and profile versions", () => {
  it("records the approved profile version at save time", async () => {
    const { job } = await upsertJob(db, { company: "Acme", title: "Engineer" });
    const assessment = {
      overview: "Role.",
      fitBasis: "role_only",
      recommendation: { verdict: "undecided", rationale: "Too early." },
    };
    expect((await saveDraft(db, { jobId: job.id, assessment })).profileVersion).toBe(0);
    expect(await listJobs(db)).toMatchObject([{ profileStale: false }]);

    await approvedFact("Remote only", "hard_requirement");
    expect(await listJobs(db)).toMatchObject([{ draftProfileVersion: 0, profileStale: true }]);
    expect(await getJobDetail(db, job.id)).toMatchObject({ profileVersion: 1, profileStale: true });

    expect((await saveDraft(db, { jobId: job.id, assessment })).profileVersion).toBe(1);
    expect(await listJobs(db, [job.id])).toMatchObject([{ profileStale: false }]);
  });
});

describe("saved job search", () => {
  it("finds jobs by company, title and draft overview, never by raw FTS syntax", async () => {
    const acme = await upsertJob(db, { company: "Acme Robotics", title: "Platform Engineer" });
    const globex = await upsertJob(db, {
      company: "Globex",
      title: "Data Engineer",
      location: "Lisbon",
    });
    await addSource(db, { jobId: globex.job.id, kind: "pasted", provider: "user", content: "x" });
    await saveDraft(db, {
      jobId: globex.job.id,
      assessment: {
        overview: "Kubernetes heavy analytics platform.",
        fitBasis: "role_only",
        recommendation: { verdict: "consider", rationale: "Interesting." },
      },
    });
    expect(await searchJobIds(db, "acme role")).toEqual([acme.job.id]); // falls back to any word
    // Falls back to any word: both match "platform", the one matching more words ranks first.
    expect((await searchJobIds(db, "the Acme platform"))[0]).toBe(acme.job.id);
    expect(await searchJobIds(db, "kubernetes")).toEqual([globex.job.id]);
    expect(await searchJobIds(db, "lisb")).toEqual([globex.job.id]);
    expect(await searchJobIds(db, "Engineer")).toHaveLength(2);
    expect(await searchJobIds(db, "nothing like this")).toEqual([]);
    expect(await searchJobIds(db, '") OR 1=1 --')).toEqual([]);
  });

  it("quotes every term", () => {
    expect(ftsQuery('Acme "NEAR" role*', "AND")).toBe('"acme"* AND "near"* AND "role"*');
    expect(ftsQuery("!!!", "AND")).toBeNull();
  });
});
