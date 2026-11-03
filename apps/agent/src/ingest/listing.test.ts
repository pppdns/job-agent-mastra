import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalLinkedInUrl,
  linkedInJobId,
  matchesIdentity,
  parseGenericPage,
  parseLinkedInPage,
} from "./listing";

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, "../../../../fixtures/listings", name), "utf8");

describe("linkedInJobId", () => {
  it.each([
    ["https://www.linkedin.com/jobs/view/4479142839", "4479142839"],
    ["https://www.linkedin.com/jobs/view/4460363900/", "4460363900"],
    ["https://hu.linkedin.com/jobs/view/software-lead-at-flex-4479142839?trk=x", "4479142839"],
    ["https://www.linkedin.com/jobs/search/?currentJobId=4455339165&keywords=ai", "4455339165"],
    [
      "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4455339165",
      "4455339165",
    ],
  ])("reads %s", (url, id) => {
    expect(linkedInJobId(new URL(url))).toBe(id);
  });

  it.each([
    "https://www.linkedin.com/feed/",
    "https://www.linkedin.com/jobs/view/abc",
    "https://evil-linkedin.com/jobs/view/4479142839",
    "https://boards.greenhouse.io/x/jobs/4479142839",
  ])("ignores %s", (url) => {
    expect(linkedInJobId(new URL(url))).toBeNull();
  });

  it("builds a canonical URL", () => {
    expect(canonicalLinkedInUrl("123456")).toBe("https://www.linkedin.com/jobs/view/123456/");
  });
});

describe("parseLinkedInPage", () => {
  it("extracts a complete guest job page without sign-in chrome or recruiter card", () => {
    const page = parseLinkedInPage(fixture("linkedin-complete.md"));
    expect(page.completeness).toEqual({ complete: true });
    expect(page.title).toBe("Senior Platform Engineer");
    expect(page.company).toBe("Northwind Robotics");
    expect(page.location).toBe("Lisbon, Portugal");
    expect(page.criteria).toEqual({
      "Seniority level": "Mid-Senior level",
      "Employment type": "Full-time",
      "Job function": "Engineering and Information Technology",
      Industries: "Automation Machinery Manufacturing",
    });
    expect(page.description).toMatch(/^Northwind Robotics builds warehouse robots/);
    expect(page.description).toContain("on-call rotation for platform services");
    for (const noise of [
      "Join now",
      "Dana Example",
      "Talent Partner",
      "Show more",
      "Similar jobs",
    ]) {
      expect(page.description).not.toContain(noise);
    }
  });

  it("treats an expired job's search page as no listing", () => {
    expect(parseLinkedInPage(fixture("linkedin-expired.md")).completeness).toMatchObject({
      complete: false,
      reason: "no_listing",
    });
  });

  it("treats a sign-in page as no listing", () => {
    expect(parseLinkedInPage(fixture("linkedin-login.md")).completeness).toMatchObject({
      complete: false,
      reason: "no_listing",
    });
  });

  it("flags a truncated description as incomplete but keeps the identity", () => {
    const page = parseLinkedInPage(fixture("linkedin-truncated.md"));
    expect(page.completeness).toMatchObject({ complete: false, reason: "incomplete" });
    expect(page.title).toBe("Senior Platform Engineer");
    expect(page.company).toBe("Northwind Robotics");
  });
});

describe("parseGenericPage and matchesIdentity", () => {
  const expected = { title: "Senior Platform Engineer", company: "Northwind Robotics" };

  it("accepts the matching employer posting", () => {
    const page = parseGenericPage(fixture("ats-complete.md"));
    expect(page.completeness).toEqual({ complete: true });
    expect(page.title).toBe("Senior Platform Engineer");
    expect(matchesIdentity(page, expected)).toBe(true);
  });

  it("rejects the same title at a different company", () => {
    const page = parseGenericPage(fixture("ats-other-company.md"));
    expect(page.completeness).toEqual({ complete: true });
    expect(matchesIdentity(page, expected)).toBe(false);
  });

  it("rejects a sign-in page as too short", () => {
    expect(parseGenericPage(fixture("linkedin-login.md")).completeness).toMatchObject({
      complete: false,
      reason: "no_listing",
    });
  });
});
