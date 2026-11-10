import type { DiscoveryRun, FunnelResult, SourceRunResult } from "@copilot/db";
import { describe, expect, it } from "vitest";
import { runOutcome } from "./run-outcome";

const source = (over: Partial<SourceRunResult>): SourceRunResult => ({
  source: "himalayas",
  fetched: 10,
  invalid: 0,
  filtered: 0,
  newJobs: 5,
  merged: 0,
  seen: 0,
  costUsd: 0,
  durationMs: 1000,
  status: "ok",
  ...over,
});

const funnel = (digest?: FunnelResult["digest"]): FunnelResult => ({
  triaged: 5,
  triageFailed: 0,
  triagePending: 0,
  matched: 1,
  assessed: 1,
  assessFailed: 0,
  llmUsd: 0.01,
  ...(digest ? { digest } : {}),
});

const run = (over: Partial<DiscoveryRun>) => ({
  status: "completed" as DiscoveryRun["status"],
  sources: [source({})],
  funnel: null as FunnelResult | null,
  error: null as string | null,
  ...over,
});

describe("runOutcome", () => {
  it("calls a completed run without problems all good", () => {
    const outcome = runOutcome(
      run({ funnel: funnel({ status: "sent", message: "sent", matches: 1 }) }),
    );
    expect(outcome).toMatchObject({ label: "All good", tone: "success", problems: [] });
  });

  it("uses the problems the report step saved", () => {
    const outcome = runOutcome(
      run({
        funnel: funnel({
          status: "sent",
          message: "sent",
          matches: 1,
          problems: ["LinkedIn failed: 402", "Dice skipped: budget"],
        }),
      }),
    );
    expect(outcome.label).toBe("2 problems");
    expect(outcome.tone).toBe("warning");
    expect(outcome.problems).toEqual(["LinkedIn failed: 402", "Dice skipped: budget"]);
  });

  it("falls back to source failures and failed steps when there is no report", () => {
    const outcome = runOutcome(
      run({
        sources: [
          source({ status: "failed", message: "401" }),
          source({ source: "linkedin", status: "partial", failures: ["search 2 failed"] }),
          source({ source: "remotive", status: "partial" }), // a cap, not a problem
        ],
        funnel: { ...funnel(), stoppedBy: "triage failed: boom" },
      }),
    );
    expect(outcome.problems).toEqual([
      "Himalayas failed: 401",
      "LinkedIn: 1 failed (search 2 failed)",
      "triage failed: boom",
    ]);
    expect(outcome.label).toBe("3 problems");
  });

  it("counts a failed email as a problem", () => {
    const outcome = runOutcome(
      run({ funnel: funnel({ status: "failed", message: "Resend answered 500", matches: 3 }) }),
    );
    expect(outcome.problems).toEqual(["Email failed: Resend answered 500"]);
    expect(outcome.label).toBe("1 problem");
  });

  it("does not count an expected cap stop as a problem", () => {
    const outcome = runOutcome(run({ funnel: { ...funnel(), stoppedBy: "triage cap (400)" } }));
    expect(outcome.label).toBe("All good");
  });

  it("explains interrupted and failed runs", () => {
    expect(runOutcome(run({ status: "interrupted" })).summary).toMatch(/next run catches up/);
    expect(
      runOutcome(run({ status: "interrupted", error: "Stopped from /discovery" })).summary,
    ).toBe("Stopped from /discovery");
    expect(runOutcome(run({ status: "failed", error: "all sources failed" }))).toMatchObject({
      label: "Failed",
      tone: "destructive",
      summary: "all sources failed",
    });
  });
});
