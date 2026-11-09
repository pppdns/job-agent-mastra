import type { JobOverview } from "@copilot/db";
import type { AssessmentSummary } from "@copilot/shared";
import { describe, expect, it } from "vitest";
import { inTab, jobListHref, parseJobListParams, sortJobs, tabCounts } from "./job-list";

const counts = { hardConflicts: 0, weaknesses: 0, softTradeoffs: 0, strengths: 0, unknowns: 0 };

const job = (id: string, summary?: Partial<AssessmentSummary>): JobOverview => ({
  id,
  title: null,
  company: null,
  location: null,
  status: "new",
  statusChangedAt: null,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  postedAt: null,
  postedBasis: null,
  draftVersion: null,
  draftProfileVersion: null,
  profileStale: false,
  summary: summary
    ? {
        headline: "",
        salary: undefined,
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

  it("keeps equally recent jobs in the given order for latest", () => {
    expect(ids(sortJobs(jobs, "latest"))).toEqual(ids(jobs));
  });

  it("orders latest by last update, e.g. search results that arrive by relevance", () => {
    const at = (id: string, ms: number) => ({ ...job(id), updatedAt: new Date(ms) });
    const byRelevance = [at("older", 1), at("newest", 3), at("middle", 2)];
    expect(ids(sortJobs(byRelevance, "latest"))).toEqual(["newest", "middle", "older"]);
    expect(ids(sortJobs(byRelevance, "fit"))).toEqual(["newest", "middle", "older"]);
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

describe("parseJobListParams", () => {
  it("accepts known values and falls back to defaults", () => {
    expect(parseJobListParams({ tab: "applied", q: "  acme ", sort: "fit" })).toEqual({
      tab: "applied",
      q: "acme",
      sort: "fit",
    });
    expect(parseJobListParams({ tab: "bogus", sort: "x" })).toEqual({
      tab: "active",
      q: "",
      sort: "latest",
    });
    expect(parseJobListParams({ tab: ["archived", "new"], sort: ["fit"] })).toMatchObject({
      tab: "archived",
      sort: "fit",
    });
  });

  it("round-trips through jobListHref without defaults", () => {
    expect(jobListHref({ tab: "active", q: "", sort: "latest" })).toBe("/jobs");
    expect(jobListHref({ tab: "applied", q: "acme berlin", sort: "fit" })).toBe(
      "/jobs?tab=applied&q=acme+berlin&sort=fit",
    );
  });
});

describe("tabs", () => {
  const at = new Date(0);
  const jobs = [
    { status: "new", archivedAt: null },
    { status: "applied", archivedAt: null },
    { status: "applied", archivedAt: at }, // archived by hand
    { status: "dismissed", archivedAt: at },
  ] as const;

  it("puts archived jobs only on the archived tab", () => {
    expect(jobs.filter((j) => inTab(j, "applied"))).toHaveLength(1);
    expect(jobs.filter((j) => inTab(j, "active"))).toHaveLength(2);
    expect(jobs.filter((j) => inTab(j, "archived"))).toHaveLength(2);
  });

  it("counts every tab", () => {
    expect(tabCounts([...jobs])).toEqual({
      active: 2,
      new: 1,
      shortlisted: 0,
      applied: 1,
      interviewing: 0,
      offer: 0,
      archived: 2,
    });
  });
});
