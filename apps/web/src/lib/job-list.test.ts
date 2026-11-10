import { describe, expect, it } from "vitest";
import { defaultSort, hasFilters, jobListHref, parseJobListParams, withParams } from "./job-list";

describe("parseJobListParams", () => {
  it("accepts known values and falls back to defaults", () => {
    expect(
      parseJobListParams({
        tab: "applied",
        q: "  data  ",
        sort: "fit",
        source: "linkedin",
        min: "75",
        posted: "7",
        unseen: "1",
        page: "3",
      }),
    ).toEqual({
      tab: "applied",
      q: "data",
      sort: "fit",
      source: "linkedin",
      minScore: 75,
      postedWithinDays: 7,
      unseen: true,
      page: 3,
    });
    expect(
      parseJobListParams({
        tab: "nope",
        sort: "x",
        source: "x",
        min: "33",
        posted: "2",
        page: "-1",
      }),
    ).toEqual({
      tab: "active",
      q: "",
      sort: "latest",
      source: undefined,
      minScore: undefined,
      postedWithinDays: undefined,
      unseen: false,
      page: 1,
    });
  });

  it("sorts the New tab (the inbox) by best fit by default", () => {
    expect(defaultSort("new")).toBe("fit");
    expect(parseJobListParams({ tab: "new" }).sort).toBe("fit");
    expect(parseJobListParams({ tab: "applied" }).sort).toBe("latest");
  });

  it("round-trips through jobListHref without defaults", () => {
    const params = parseJobListParams({ tab: "new", source: "himalayas", min: "60", page: "2" });
    expect(jobListHref(params)).toBe("/jobs?tab=new&source=himalayas&min=60&page=2");
    expect(
      parseJobListParams(
        Object.fromEntries(new URL(`http://x${jobListHref(params)}`).searchParams),
      ),
    ).toEqual(params);
    expect(jobListHref(parseJobListParams({}))).toBe("/jobs");
  });

  it("goes back to page 1 and the tab's default sort when the list changes", () => {
    const params = parseJobListParams({ tab: "new", page: "4" });
    expect(withParams(params, { minScore: 90 })).toBe("/jobs?tab=new&min=90");
    expect(withParams(params, { tab: "applied" })).toBe("/jobs?tab=applied");
    expect(hasFilters(params)).toBe(false);
    expect(hasFilters({ ...params, unseen: true })).toBe(true);
  });
});
