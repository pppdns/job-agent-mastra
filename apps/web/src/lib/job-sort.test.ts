import type { JobOverview } from "@copilot/db";
import type { AssessmentSummary } from "@copilot/shared";
import { describe, expect, it } from "vitest";
import { parseJobSort, sortJobs } from "./job-sort";

const counts = { hardConflicts: 0, weaknesses: 0, softTradeoffs: 0, strengths: 0, unknowns: 0 };

const job = (id: string, summary?: Partial<AssessmentSummary>): JobOverview => ({
  id,
  title: null,
  company: null,
  location: null,
  updatedAt: new Date(0),
  draftVersion: null,
  approvedVersion: null,
  pendingApproval: false,
  draftProfileVersion: null,
  profileStale: false,
  summary: summary
    ? {
        headline: "",
        verdict: "consider",
        fitBasis: "with_profile",
        fitLevel: undefined,
        counts,
        ...summary,
      }
    : null,
});

const ids = (jobs: JobOverview[]) => jobs.map((j) => j.id);

describe("sortJobs", () => {
  const jobs = [
    job("unassessed"),
    job("weak", { fitLevel: "weak" }),
    job("role-only", { fitBasis: "role_only", verdict: "pursue" }),
    job("good-pass", { fitLevel: "good", verdict: "pass" }),
    job("strong", { fitLevel: "strong" }),
    job("good-pursue", { fitLevel: "good", verdict: "pursue" }),
  ];

  it("keeps the given (newest first) order for latest", () => {
    expect(sortJobs(jobs, "latest")).toBe(jobs);
  });

  it("orders by fit, then verdict, with unscored jobs last", () => {
    expect(ids(sortJobs(jobs, "fit"))).toEqual([
      "strong",
      "good-pursue",
      "good-pass",
      "weak",
      "role-only",
      "unassessed",
    ]);
  });

  it("breaks ties by hard conflicts, then keeps newest first", () => {
    const tied = [
      job("newer-conflict", {
        fitLevel: "good",
        counts: { ...counts, hardConflicts: 1 },
      }),
      job("newer", { fitLevel: "good" }),
      job("older", { fitLevel: "good" }),
    ];
    expect(ids(sortJobs(tied, "fit"))).toEqual(["newer", "older", "newer-conflict"]);
  });
});

describe("parseJobSort", () => {
  it("accepts fit and falls back to latest", () => {
    expect(parseJobSort("fit")).toBe("fit");
    expect(parseJobSort("latest")).toBe("latest");
    expect(parseJobSort(undefined)).toBe("latest");
    expect(parseJobSort(["fit", "x"])).toBe("latest");
  });
});
