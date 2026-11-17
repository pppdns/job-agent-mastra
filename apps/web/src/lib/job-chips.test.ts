import { type ListingFacts, preferencesSchema } from "@copilot/shared";
import { describe, expect, it } from "vitest";
import { jobChips } from "./job-chips";

const prefs = preferencesSchema.parse({
  home: { city: "Budapest", country: "Hungary" },
  workMode: {
    remote: "preferred",
    hybrid: [{ place: "Budapest", level: "disliked" }],
    hybridElsewhere: "no",
    onsiteElsewhere: "no",
  },
  salary: { floor: 90_000, high: 145_000, currency: "EUR" },
  languages: [
    { name: "TypeScript", level: "preferred" },
    { name: "PHP", level: "no" },
  ],
  roleFocus: [{ focus: "ml_research", level: "no" }],
  levels: [{ level: "staff", preference: "preferred" }],
  travel: { okUpTo: "quarterly" },
});

const facts = (over: Partial<ListingFacts> = {}): ListingFacts => ({
  workMode: "remote",
  workModeQuote: "Fully remote",
  remoteScope: "restricted",
  scopeQuote: null,
  places: [{ place: "EU", basis: "residence", quote: "anywhere in the EU" }],
  signals: [],
  openSignals: [],
  officeDays: null,
  salary: null,
  level: null,
  languages: [],
  roleFocus: [],
  travel: null,
  employmentType: null,
  timezone: null,
  headerPlaces: [],
  levelFrom: null,
  ...over,
});

const chips = (
  f: ListingFacts | null,
  eligibility: Parameters<typeof jobChips>[0]["eligibility"],
) => jobChips({ facts: f, eligibility, eligibilityQuote: "anywhere in the EU" }, prefs);

describe("jobChips", () => {
  it("shows an open remote role green with its place, pay and level", () => {
    const { primary } = chips(
      facts({
        salary: { min: 120_000, max: 150_000, currency: "EUR", period: "year", quote: "€120–150k" },
        level: { level: "staff", quote: "Staff Engineer" },
      }),
      "open",
    );
    expect(primary.map((c) => [c.label, c.tone, !!c.filled, !!c.dashed])).toEqual([
      ["Remote · EU", "success", false, false],
      ["€120–150k", "success", true, false],
      ["Staff", "success", true, false],
    ]);
    expect(primary[0]?.quote).toBe("anywhere in the EU");
  });

  it("marks unsure places dashed, closed ones red, unread facts as unknown", () => {
    expect(chips(facts(), "likely_open").primary[0]).toMatchObject({
      label: "Remote · EU ?",
      dashed: true,
      tone: "success",
    });
    expect(chips(facts({ places: [] }), "unclear").primary[0]).toMatchObject({
      label: "Remote ?",
      tone: "warning",
      dashed: true,
    });
    expect(chips(facts(), "closed").primary[0]).toMatchObject({ tone: "destructive" });
    expect(chips(null, null).primary.map((c) => c.label)).toEqual(["Location ?", "No salary"]);
  });

  it("colors hybrid by the place's level and shows office days", () => {
    const hybrid = facts({
      workMode: "hybrid",
      workModeQuote: "Hybrid",
      places: [{ place: "Budapest, Hungary", basis: "office", quote: "Budapest office" }],
      officeDays: { perWeek: 2, quote: "2 days a week" },
    });
    expect(chips(hybrid, "open").primary[0]).toMatchObject({
      label: "Hybrid · Budapest · 2d/wk",
      tone: "warning",
    });
  });

  it("puts pay under the floor in red, converting currencies roughly", () => {
    const low = facts({
      salary: { min: 50_000, max: 60_000, currency: "USD", period: "year", quote: "$50–60k" },
    });
    expect(chips(low, "open").primary[1]).toMatchObject({ label: "$50–60k", tone: "destructive" });
    const monthly = facts({
      salary: { min: 6_000, max: 8_000, currency: "EUR", period: "month", quote: "€6–8k/mo" },
    });
    expect(chips(monthly, "open").primary[1]).toMatchObject({ label: "€6–8k/mo", tone: "muted" });
  });

  it("colors languages, focus and travel by preference, deal-breakers first", () => {
    const { secondary } = chips(
      facts({
        languages: [
          { name: "TypeScript", required: true, quote: "TypeScript" },
          { name: "PHP", required: true, quote: "PHP" },
          { name: "Go", required: false, quote: "Go is a plus" },
        ],
        roleFocus: [{ focus: "ml_research", quote: "train models" }],
        travel: { frequency: "frequent", quote: "travel to client sites" },
      }),
      "open",
    );
    expect(secondary.map((c) => [c.label, c.tone])).toEqual([
      ["PHP", "destructive"],
      ["ML research / training", "destructive"],
      ["Travel: frequent travel", "destructive"],
      ["TypeScript", "success"],
    ]);
  });
});
