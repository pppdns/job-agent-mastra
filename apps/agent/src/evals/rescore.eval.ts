import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addSource,
  decideApproval,
  findWorkspaceRoot,
  getJobDetail,
  proposeProfileChange,
  resetAppTables,
  resolveDatabaseUrl,
  saveDraft,
  upsertJob,
} from "@copilot/db";
import { allPoints } from "@copilot/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { getAppDb } from "../mastra/app-db";
import { type RescoreEvent, runRescore } from "../rescore/run";
import { profileSuite } from "./cases";

// Live batch rescorer (structured output, no retry): every stale job must get a valid
// with_profile draft, because saveDraft rejects fit points that aren't inference.
const LISTINGS = [
  { file: "ats-complete.md", title: "Senior Platform Engineer", company: "Northwind Robotics" },
  {
    file: "remote-ambiguous.md",
    title: "Staff Backend Engineer, Payments",
    company: "Lumen Ledger",
  },
  { file: "injection.md", title: "Senior Data Engineer", company: "Brightfield Analytics" },
];

// EVAL_ONLY targets cases by name; skip this billable suite unless it matches "rescorer".
const ONLY = process.env.EVAL_ONLY?.trim().toLowerCase();

describe.skipIf(ONLY && !"rescorer".includes(ONLY))("rescorer (live)", () => {
  let result: Awaited<ReturnType<typeof runRescore>>;

  beforeAll(async () => {
    if (!resolveDatabaseUrl().endsWith("/data/eval.db")) {
      throw new Error("evals must run on data/eval.db (use pnpm eval)");
    }
    const db = await getAppDb();
    await resetAppTables(db);
    // Role-only drafts first, then the profile: every job is stale.
    for (const l of LISTINGS) {
      const { job } = await upsertJob(db, { title: l.title, company: l.company });
      const content = readFileSync(join(findWorkspaceRoot(), "fixtures/listings", l.file), "utf8");
      const { source } = await addSource(db, {
        jobId: job.id,
        kind: "pasted",
        provider: "user",
        content,
      });
      await saveDraft(db, {
        jobId: job.id,
        assessment: {
          overview: `${l.title} at ${l.company}.`,
          fitBasis: "role_only",
          strengths: [{ text: "Listing read", evidence: "official", sourceIds: [source.id] }],
          recommendation: { verdict: "undecided", rationale: "Not assessed against a profile." },
        },
      });
    }
    const { approval } = await proposeProfileChange(db, {
      threadId: "eval-seed",
      proposal: {
        changes: profileSuite.profile.map((f) => ({ op: "add", ...f })),
        reason: "Eval seed profile",
      },
    });
    await decideApproval(db, {
      approvalId: approval.id,
      threadId: "eval-seed",
      decision: "approve",
      payloadHash: approval.payloadHash,
    });
    const events: RescoreEvent[] = [];
    result = await runRescore({}, { db, emit: async (e) => void events.push(e) });
    console.log(
      result.results
        .map((r) => `${r.title}: ${r.status === "saved" ? `saved v${r.version}` : r.reason}`)
        .join("\n"),
    );
  });

  it("saves a valid with_profile draft for every stale job", async () => {
    expect(result.results).toHaveLength(LISTINGS.length);
    for (const r of result.results) {
      expect(r.status === "saved" ? null : r.reason, r.title ?? r.jobId).toBeNull();
    }
    const db = await getAppDb();
    for (const r of result.results) {
      const detail = await getJobDetail(db, r.jobId);
      const assessment = detail?.draft?.assessment;
      expect(assessment?.fitBasis).toBe("with_profile");
      const fitPoints = assessment
        ? allPoints(assessment).filter((p) => p.profileFactIds.length)
        : [];
      expect(fitPoints.length).toBeGreaterThan(0);
      expect(fitPoints.every((p) => p.evidence === "inference")).toBe(true);
    }
  });
});
