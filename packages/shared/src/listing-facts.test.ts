import { describe, expect, it } from "vitest";
import {
  decideEligibility,
  type ListingFactsInput,
  levelFromTitle,
  verifyFacts,
} from "./listing-facts";
import type { Home } from "./remote-scope";

const HOME: Home = { city: "Budapest", country: "Hungary" };

const NONE: ListingFactsInput = {
  workMode: "unclear",
  workModeQuote: null,
  remoteScope: "unspecified",
  scopeQuote: null,
  places: [],
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
};

/** Facts whose every quote is the listing itself, so verification keeps them. */
function decide(listing: string, facts: Partial<ListingFactsInput>) {
  return decideEligibility(verifyFacts({ ...NONE, ...facts }, listing, null), HOME);
}

describe("verifyFacts", () => {
  const listing = "Remote within the EU. Pay: EUR 70,000 – 90,000 a year. We use TypeScript.";

  it("drops items whose quote isn't in the listing", () => {
    const facts = verifyFacts(
      {
        ...NONE,
        languages: [
          { name: "TypeScript", required: true, quote: "We use TypeScript" },
          { name: "Rust", required: true, quote: "We love Rust" },
        ],
        remoteScope: "worldwide",
        scopeQuote: "Work from anywhere",
      },
      listing,
      null,
    );
    expect(facts.languages.map((l) => l.name)).toEqual(["TypeScript"]);
    expect(facts.remoteScope).toBe("unspecified");
  });

  it("keeps a salary only when the listing states its figures", () => {
    const salary = (min: number, max: number) =>
      verifyFacts(
        {
          ...NONE,
          salary: { min, max, currency: "EUR", period: "year", quote: "EUR 70,000 – 90,000" },
        },
        listing,
        null,
      ).salary;
    expect(salary(70_000, 90_000)).toMatchObject({ min: 70_000, max: 90_000 });
    expect(salary(70_000, 95_000)).toBeNull();
  });

  it("takes the level from the title first, and reads board header places", () => {
    const facts = verifyFacts(
      { ...NONE, level: { level: "senior", quote: "Pay" } },
      "Remote: yes (Poland, Hungary)\n\nPay",
      "Staff Engineer",
    );
    expect(facts.level).toEqual({ level: "staff", quote: "Staff Engineer" });
    expect(facts.levelFrom).toBe("title");
    expect(facts.headerPlaces).toEqual(["Poland, Hungary"]);
  });
});

describe("levelFromTitle", () => {
  it.each([
    ["Founding Engineer", "founding"],
    ["Staff / Principal Software Engineer", "principal"],
    ["Head of Engineering", "head"],
    ["Engineering Team Lead", "lead"],
    ["Sr. Backend Engineer", "senior"],
    ["Junior Developer", "junior"],
    ["Member of Technical Staff", null],
    ["Software Engineer", null],
  ] as const)("%s → %s", (title, level) => {
    expect(levelFromTitle(title)).toBe(level);
  });
});

// Cases from real listings in the location-scope eval.
describe("decideEligibility", () => {
  it("opens on a residence region that includes home, even next to other countries", () => {
    const listing = "Remote, from Serbia, Poland, or another Eastern European country.";
    expect(
      decide(listing, {
        workMode: "remote",
        places: [
          { place: "Poland", basis: "residence", quote: listing },
          { place: "another Eastern European country", basis: "residence", quote: listing },
        ],
      }),
    ).toEqual({ eligibility: "open", quote: listing });
  });

  it("closes on a board header that names only other countries", () => {
    expect(decide("Remote: yes (United States)\n\nBuild things.", { workMode: "remote" })).toEqual({
      eligibility: "closed",
      quote: "Remote: yes (United States)",
    });
  });

  it("calls a worldwide statement next to a country restriction unclear", () => {
    const listing = "Remote: yes (United States)\n\nThis role can be executed globally.";
    expect(
      decide(listing, {
        workMode: "remote",
        remoteScope: "worldwide",
        scopeQuote: "This role can be executed globally.",
      }).eligibility,
    ).toBe("unclear");
  });

  it("opens hybrid near Budapest and closes stated office work elsewhere", () => {
    const near = "Hybrid. Location: Törökbálint, Pest, Hungary";
    expect(
      decide(near, {
        workMode: "hybrid",
        workModeQuote: "Hybrid.",
        places: [{ place: "Törökbálint, Pest, Hungary", basis: "office", quote: near }],
      }).eligibility,
    ).toBe("open");
    const far = "On site. Location: Környe, Komárom-Esztergom, Hungary";
    expect(
      decide(far, {
        workMode: "onsite",
        workModeQuote: "On site.",
        places: [{ place: "Környe, Komárom-Esztergom, Hungary", basis: "office", quote: far }],
      }).eligibility,
    ).toBe("closed");
  });

  it("softens office work elsewhere to likely closed when remote work is possible", () => {
    const listing = "Hybrid in Munich. Remote work is also possible.";
    expect(
      decide(listing, {
        workMode: "hybrid",
        workModeQuote: "Hybrid in Munich.",
        places: [{ place: "Munich", basis: "office", quote: "Munich" }],
        openSignals: [{ kind: "remote_option", quote: "Remote work is also possible." }],
      }).eligibility,
    ).toBe("likely_closed");
  });

  it("uses a listed location for a remote role, ahead of benefit hints", () => {
    const listing = "Location: United States / EMEA. Remote: yes. 401k for US employees.";
    expect(
      decide(listing, {
        workMode: "remote",
        places: [{ place: "United States / EMEA", basis: "listed", quote: "United States / EMEA" }],
        signals: [{ kind: "country_benefits", country: "United States", quote: "401k" }],
      }).eligibility,
    ).toBe("open");
  });

  it("is likely closed on work authorization or only foreign hints, unclear with nothing", () => {
    const auth = "Must be authorized to work in the United States.";
    expect(
      decide(auth, {
        workMode: "remote",
        places: [{ place: "United States", basis: "work_authorization", quote: auth }],
      }).eligibility,
    ).toBe("likely_closed");
    expect(decide("Remote. We ship fast.", { workMode: "remote" })).toEqual({
      eligibility: "unclear",
      quote: null,
    });
  });

  it("keeps a flexible remote role with a foreign listed location unclear, not closed", () => {
    const listing = "Location: Italy. Remote-first: work from wherever you're based.";
    expect(
      decide(listing, {
        workMode: "remote",
        places: [{ place: "Italy", basis: "listed", quote: "Location: Italy" }],
        openSignals: [{ kind: "location_flexible", quote: "work from wherever you're based" }],
      }).eligibility,
    ).toBe("unclear");
  });
});
