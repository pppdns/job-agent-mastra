import { describe, expect, it } from "vitest";
import { fitMatters, quietStatus, showsStageAge } from "./job-emphasis";
import { JOB_TABS } from "./job-list";

describe("job emphasis", () => {
  it("keeps fit colored while it still drives a decision", () => {
    const open = (status: Parameters<typeof fitMatters>[0]["status"]) =>
      fitMatters({ status, archivedAt: null });
    expect(["new", "shortlisted", "interviewing", "offer"].map((s) => open(s as never))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(open("applied")).toBe(false);
    expect(open("rejected")).toBe(false);
    expect(fitMatters({ status: "shortlisted", archivedAt: new Date() })).toBe(false);
  });

  it("shows time in stage on the waiting tabs and quiets the status on single-status tabs", () => {
    expect(JOB_TABS.filter(showsStageAge)).toEqual(["applied", "interviewing", "offer"]);
    expect(JOB_TABS.filter((t) => !quietStatus(t))).toEqual(["active", "archived"]);
  });
});
