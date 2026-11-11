import { describe, expect, it } from "vitest";
import type { RescoreResult } from "../../rescore/run";
import { forModel } from "./rescore-jobs";

const saved = (i: number, verdict: string): RescoreResult => ({
  jobId: `j${i}`,
  title: `Job ${i}`,
  company: "Contoso",
  status: "saved",
  draftId: `d${i}`,
  version: 2,
  before: { verdict: "pursue", fitLevel: "good" },
  after: { verdict, fitLevel: "good" },
});

const output = (results: RescoreResult[]) => ({
  status: "completed" as const,
  runId: "0-0-0-0-0" as const,
  profileVersion: 3,
  skipped: 0,
  results,
  note: "n",
});

describe("rescore_jobs model output", () => {
  it("passes small batches through in full", () => {
    const small = output([saved(1, "skip")]);
    expect(forModel(small)).toBe(small);
  });

  it("sums up big batches: counts plus the failures", () => {
    const results: RescoreResult[] = Array.from({ length: 30 }, (_, i) =>
      saved(i, i < 4 ? "skip" : "pursue"),
    );
    results.push({
      jobId: "x",
      title: "Broken",
      company: null,
      status: "failed",
      reason: "no listing",
    });
    const summary = forModel(output(results));
    expect(summary).not.toHaveProperty("results");
    expect(summary).toMatchObject({
      saved: 30,
      verdictChanged: 4,
      fitChanged: 0,
      failed: 1,
      failures: [{ title: "Broken", company: null, reason: "no listing" }],
    });
  });
});
