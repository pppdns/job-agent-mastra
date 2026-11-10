import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addSource,
  createDb,
  type Db,
  decideApproval,
  getJobDetail,
  migrateDb,
  proposeProfileChange,
  saveDraft,
  upsertJob,
} from "@copilot/db";
import { beforeEach, describe, expect, it } from "vitest";
import { findSavedJobs } from "./profile";

// Offline half of the "comparison with stale assessments" scenario (scenarios.eval.ts covers the
// model's behaviour live): the tools a comparison reads must say which saved assessments predate
// the approved profile, so the copilot flags or re-assesses them instead of comparing old verdicts.

let db: Db;

beforeEach(async () => {
  db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "stale-")), "t.db")}`);
  await migrateDb(db);
});

async function assessedJob(company: string) {
  const { job } = await upsertJob(db, { company, title: "Platform Engineer" });
  const { source } = await addSource(db, {
    jobId: job.id,
    kind: "pasted",
    provider: "user",
    content: `# Platform Engineer at ${company}\n\nBuild the platform.`,
  });
  await saveDraft(db, {
    jobId: job.id,
    assessment: {
      overview: "Role read from the listing.",
      fitBasis: "role_only",
      strengths: [{ text: "Clear scope", evidence: "official", sourceIds: [source.id] }],
      recommendation: { verdict: "investigate_further", rationale: "Looks solid." },
    },
  });
  return job.id;
}

async function approveRequirement(text: string) {
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

describe("comparison with stale assessments (tools)", () => {
  it("marks saved assessments stale once the approved profile changes, and only then", async () => {
    const acme = await assessedJob("Acme");
    const contoso = await assessedJob("Contoso");
    const stale = async () =>
      Object.fromEntries(
        (await findSavedJobs(db, { query: "platform" })).matches.map((m) => [
          m.jobId,
          m.profileStale,
        ]),
      );
    expect(await stale()).toEqual({ [acme]: false, [contoso]: false });

    // A pending proposal changes nothing; approving it makes both old assessments stale.
    const { approval } = await proposeProfileChange(db, {
      threadId: "chat-b",
      proposal: {
        changes: [{ op: "add", kind: "hard_requirement", text: "Fully remote" }],
        reason: "User said so",
      },
    });
    expect(approval.status).toBe("pending");
    expect(await stale()).toEqual({ [acme]: false, [contoso]: false });

    await approveRequirement("No more than one office day a month");
    expect(await stale()).toEqual({ [acme]: true, [contoso]: true });
    // get_job forwards the same flag with the versions, so the copilot can say what changed.
    expect(await getJobDetail(db, acme)).toMatchObject({ profileStale: true });
  });
});
