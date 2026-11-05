import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getJobDetail, listJobs, saveDraft } from "./assessments";
import { AssessmentError } from "./hash";
import { createDb, type Db, migrateDb } from "./index";
import { addSource, upsertJob } from "./jobs";
import { currentProfile, decideApproval, proposeProfileChange } from "./profile";

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
    // An unknown reference lists the current handles, so the retry can pick the right one.
    await expect(
      saveDraft(db, { jobId, assessment: withProfile([fitPoint("f99")]) }),
    ).rejects.toThrow('current facts: f1 ("At most one office day a week")');
    // Empty references never count as a citation.
    for (const empty of ["", "fact:"]) {
      await expect(
        saveDraft(db, { jobId, assessment: withProfile([fitPoint(empty)]) }),
      ).rejects.toThrow(/not in the approved profile/);
    }
    // Models cite handles ("f1", also as "fact:f1"); the full id is stored.
    const byHandle = await saveDraft(db, { jobId, assessment: withProfile([fitPoint("fact:f1")]) });
    expect(byHandle.assessment.strengths[0]?.profileFactIds).toEqual([factId]);
    await expect(
      saveDraft(db, { jobId, assessment: { ...assessment(), strengths: [fitPoint(factId)] } }),
    ).rejects.toThrow(/role_only drafts can't cite profileFactIds/);
    // Full ids still work (the web app sends them), with or without the prefix.
    const prefixed = await saveDraft(db, {
      jobId,
      assessment: withProfile([fitPoint(`fact:${factId}`)]),
    });
    expect(prefixed.assessment.strengths[0]?.profileFactIds).toEqual([factId]);
    // Listing sources and quotes stay allowed on a fit point.
    await expect(
      saveDraft(db, { jobId, assessment: withProfile([fitPoint(factId)]) }),
    ).resolves.toMatchObject({ version: 3 });
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

  it("accepts a salary only when its figures are in the job's sources", async () => {
    await addSource(db, {
      jobId,
      kind: "pasted",
      provider: "user",
      content: "Salary range EUR 75,000 – 90,000 per year plus equity.",
    });
    const withSalary = (salary: string) => ({ ...assessment(), salary });
    await saveDraft(db, { jobId, assessment: withSalary("EUR 75,000 – 90,000 / year + equity") });
    await saveDraft(db, { jobId, assessment: withSalary("EUR 75k–90k") });
    await expect(
      saveDraft(db, { jobId, assessment: withSalary("EUR 85,000 – 95,000") }),
    ).rejects.toThrow(/salary figures 85000, 95000 are not in this job's sources/);
    const [job] = await listJobs(db, [jobId]);
    expect(job?.summary?.salary).toBe("EUR 75k–90k");
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

describe("read models", () => {
  it("lists jobs with their latest version and keeps earlier ones as history", async () => {
    await saveDraft(db, { jobId, assessment: assessment() });
    expect(await listJobs(db)).toMatchObject([{ id: jobId, draftVersion: 1 }]);
    await saveDraft(db, { jobId, assessment: assessment("Revised") });
    expect(await listJobs(db)).toMatchObject([{ draftVersion: 2 }]);
    const detail = await getJobDetail(db, jobId);
    expect(detail).toMatchObject({
      draft: { version: 2, assessment: { overview: "Revised" } },
      history: [{ version: 1 }],
      sources: [{ kind: "pasted" }],
    });
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
