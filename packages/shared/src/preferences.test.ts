import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  hasPreferences,
  parsePreferences,
  preferencesSchema,
  renderPreferences,
} from "./preferences";

describe("preferences", () => {
  it("parse to defaults, and an unreadable value falls back to them", () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences({ salary: { floor: "lots" } })).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences({ salary: { floor: 90_000 } }).salary).toEqual({
      floor: 90_000,
      high: null,
      currency: "EUR",
    });
    expect(hasPreferences(DEFAULT_PREFERENCES)).toBe(false);
  });

  it("render fixed sentences, grouped by level", () => {
    const p = preferencesSchema.parse({
      home: { city: "Budapest", country: "Hungary" },
      workMode: {
        remote: "preferred",
        hybrid: [{ place: "Budapest", level: "disliked" }],
        hybridElsewhere: "no",
        onsiteElsewhere: "no",
        maxOfficeDaysPerWeek: 2,
      },
      salary: { floor: 90_000, high: 145_000 },
      languages: [
        { name: "TypeScript", level: "preferred" },
        { name: "PHP", level: "no" },
        { name: "Ruby", level: "no" },
      ],
      roleFocus: [{ focus: "ml_research", level: "no" }],
      levels: [{ level: "staff", preference: "preferred" }],
      travel: { okUpTo: "monthly" },
    });
    expect(renderPreferences(p)).toEqual([
      "Lives in Budapest, Hungary (won't relocate).",
      "Remote work (from Hungary): preferred.",
      "Hybrid in Budapest: acceptable but disliked.",
      "Hybrid elsewhere: not acceptable (deal-breaker).",
      "On-site elsewhere: not acceptable (deal-breaker).",
      "Hybrid: at most 2 office days a week.",
      "Pay below 90,000 EUR a year: not OK.",
      "Pay at or above 145,000 EUR a year: great.",
      "Main programming languages preferred: TypeScript.",
      "Main programming languages not acceptable (deal-breaker): PHP, Ruby.",
      "Roles mainly about not acceptable (deal-breaker): ML research / training.",
      "Levels preferred: Staff.",
      "Travel: fine up to about monthly; more is disliked.",
    ]);
    expect(renderPreferences(DEFAULT_PREFERENCES)).toEqual([]);
  });

  it("reject invalid values", () => {
    expect(preferencesSchema.safeParse({ salary: { currency: "euro" } }).success).toBe(false);
    expect(
      preferencesSchema.safeParse({ languages: [{ name: "Go", level: "love" }] }).success,
    ).toBe(false);
  });
});
