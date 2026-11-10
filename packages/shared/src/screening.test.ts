import { describe, expect, it } from "vitest";
import { companyKey, type PostingInput, postingSnapshot } from "./posting";
import { screenPosting } from "./screening";
import {
  DEFAULT_SEARCH_SETTINGS,
  parseSearchSettings,
  type SearchSettings,
} from "./search-settings";

const now = new Date("2026-11-10T12:00:00Z");

const posting = (over: Partial<PostingInput> = {}): PostingInput => ({
  source: "himalayas",
  externalId: "x1",
  url: "https://himalayas.app/companies/orbit/jobs/x1",
  applyUrl: null,
  title: "Senior Software Engineer",
  company: "Orbit Labs",
  location: null,
  remote: null,
  regions: [],
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
  salaryText: null,
  seniority: null,
  employmentType: null,
  postedAt: new Date("2026-11-09T00:00:00Z"),
  description: "Build things.",
  ...over,
});

const settings = (over: Partial<SearchSettings> = {}): SearchSettings => ({
  ...DEFAULT_SEARCH_SETTINGS,
  ...over,
});

describe("screenPosting", () => {
  it("passes titles that match none of the search queries (titles vary too much)", () => {
    for (const title of ["Product Engineer", "Member of Technical Staff", "Builder #3"]) {
      expect(screenPosting(settings(), posting({ title }), now)).toEqual({
        pass: true,
        reasons: [],
      });
    }
  });

  it("passes unknowns: no salary, no date, remote status unknown, no location", () => {
    const result = screenPosting(
      settings({ minSalary: { amount: 100_000, currency: "EUR" } }),
      posting({ postedAt: null, remote: null, location: "Lisbon, Portugal" }),
      now,
    );
    expect(result.pass).toBe(true);
  });

  it("excludes by whole words of a phrase, not substrings", () => {
    expect(
      screenPosting(settings(), posting({ title: "Software Engineering Intern" }), now),
    ).toMatchObject({ pass: false, reasons: ['title contains "intern"'] });
    expect(screenPosting(settings(), posting({ title: "Internal Tools Engineer" }), now).pass).toBe(
      true,
    );
    expect(screenPosting(settings(), posting({ title: "Salesforce Developer" }), now).pass).toBe(
      true,
    );
    expect(
      screenPosting(settings(), posting({ title: "Executive Account Manager" }), now).reasons,
    ).toEqual(['title contains "account executive"']);
  });

  it("blocks companies by company key", () => {
    const result = screenPosting(
      settings({ blockedCompanies: ["Orbit Labs GmbH"] }),
      posting({ company: "ORBIT LABS, Inc." }),
      now,
    );
    expect(result.reasons).toEqual(["company ORBIT LABS, Inc. is blocked"]);
  });

  it("screens out old postings, with a wider limit for backfills", () => {
    const old = posting({ postedAt: new Date("2026-10-01T00:00:00Z") });
    expect(screenPosting(settings(), old, now).reasons).toEqual(["posted 40 days ago"]);
    expect(screenPosting(settings(), old, now, 60).pass).toBe(true);
  });

  it("applies the salary floor only to stated pay in the same currency", () => {
    const floor = settings({ minSalary: { amount: 90_000, currency: "EUR" } });
    expect(
      screenPosting(
        floor,
        posting({ salaryMax: 6_000, salaryCurrency: "EUR", salaryPeriod: "month" }),
        now,
      ).reasons,
    ).toEqual(["pay tops out at 72,000 EUR/year"]);
    expect(
      screenPosting(
        floor,
        posting({ salaryMax: 8_000, salaryCurrency: "EUR", salaryPeriod: "month" }),
        now,
      ).pass,
    ).toBe(true);
    expect(
      screenPosting(floor, posting({ salaryMax: 50_000, salaryCurrency: "USD" }), now).pass,
    ).toBe(true);
  });

  it("checks remote region restrictions against allowed regions, expanding Europe", () => {
    const s = settings();
    expect(screenPosting(s, posting({ remote: true, regions: ["Germany"] }), now).pass).toBe(true);
    expect(screenPosting(s, posting({ remote: true, regions: ["United States"] }), now).pass).toBe(
      true,
    );
    expect(screenPosting(s, posting({ remote: true, regions: [] }), now).pass).toBe(true);
    expect(screenPosting(s, posting({ remote: true, regions: ["Worldwide"] }), now).pass).toBe(
      true,
    );
    expect(
      screenPosting(s, posting({ remote: true, regions: ["India", "Philippines"] }), now).reasons,
    ).toEqual(["remote only from India, Philippines"]);
  });

  it("screens out non-remote roles outside the allowed places", () => {
    const s = settings();
    expect(
      screenPosting(s, posting({ remote: false, location: "Budapest, Hungary" }), now).pass,
    ).toBe(true);
    expect(
      screenPosting(s, posting({ remote: false, location: "Munich, Germany" }), now).reasons,
    ).toEqual(["not remote, in Munich, Germany"]);
  });
});

describe("companyKey", () => {
  it("drops legal suffixes, punctuation, case and a leading 'the'", () => {
    expect(companyKey("Acme, Inc.")).toBe("acme");
    expect(companyKey("ACME Inc")).toBe("acme");
    expect(companyKey("The Orbit Company GmbH")).toBe("orbit");
    expect(companyKey("Zürich Labs AG")).toBe("zurich labs");
  });

  it("never empties the name", () => {
    expect(companyKey("Co")).toBe("co");
    expect(companyKey("The")).toBe("the");
  });
});

describe("parseSearchSettings", () => {
  it("fills defaults, also for nested source settings", () => {
    const s = parseSearchSettings({ queries: ["Staff Engineer"], sources: { linkedin: {} } });
    expect(s.queries).toEqual(["Staff Engineer"]);
    expect(s.sources.linkedin.locations).toEqual(
      DEFAULT_SEARCH_SETTINGS.sources.linkedin.locations,
    );
    expect(s.sources.himalayas.enabled).toBe(true);
  });

  it("falls back to the defaults for an unreadable row", () => {
    expect(parseSearchSettings({ maxAgeDays: "soon" })).toEqual(DEFAULT_SEARCH_SETTINGS);
  });
});

describe("postingSnapshot", () => {
  it("states title, place, pay and posting date in a header the parsers read", () => {
    const text = postingSnapshot(
      posting({
        remote: true,
        regions: ["Germany"],
        salaryText: "€80,000–€100,000/year",
        location: "Remote",
      }),
      "Himalayas",
    );
    expect(text).toContain("# Senior Software Engineer");
    expect(text).toContain("Remote: yes (Germany)");
    expect(text).toContain("Salary: €80,000–€100,000/year");
    expect(text).toContain("Posted: 2026-11-09");
    expect(text).toContain("Source: Himalayas");
  });
});
