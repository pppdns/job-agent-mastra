import { describe, expect, it } from "vitest";
import { locationBlockReason, quoteInSources } from "./location-block";

describe("quoteInSources", () => {
  const listing =
    "# AI Engineer\n\nRemote: yes (United States)\n\nThis role is **US-only**; candidates must reside in the U.S.";

  it("finds quotes regardless of case, punctuation and markdown", () => {
    expect(quoteInSources("Remote: yes (United States)", [listing])).toBe(true);
    expect(quoteInSources("this role is US-only", [listing])).toBe(true);
    expect(quoteInSources("candidates must reside in the U.S.", ["x", listing])).toBe(true);
  });

  it("rejects made-up, partial-word and empty quotes", () => {
    expect(quoteInSources("UK residents only", [listing])).toBe(false);
    expect(quoteInSources("ted States", [listing])).toBe(false);
    expect(quoteInSources("…", [listing])).toBe(false);
  });
});

it("locationBlockReason names the places and the quote", () => {
  expect(locationBlockReason({ places: ["United States"], quote: "US-only" })).toBe(
    "only hires in United States: “US-only”",
  );
});
