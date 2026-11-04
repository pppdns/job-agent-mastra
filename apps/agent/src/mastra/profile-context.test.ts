import type { ProfileFact } from "@copilot/db";
import { describe, expect, it } from "vitest";
import { formatProfile, profileLearningHint, THIN_PROFILE_FACTS } from "./profile-context";

let handle = 0;
const fact = (id: string, kind: ProfileFact["kind"], text: string) =>
  ({
    id,
    handle: ++handle,
    kind,
    text,
    createdInVersion: 1,
    supersededInVersion: null,
    supersedesId: null,
    createdAt: new Date(),
  }) as ProfileFact;

describe("formatProfile", () => {
  it("says the profile is empty", () => {
    expect(formatProfile({ version: 0, facts: [] })).toMatch(/version 0\): empty/);
  });

  it("groups facts by kind with their handles, never the full ids", () => {
    handle = 6;
    expect(
      formatProfile({
        version: 3,
        facts: [
          fact("b", "soft_preference", "Small teams"),
          fact("a", "hard_requirement", "Remote only"),
        ],
      }),
    ).toBe(
      [
        "Approved profile (version 3):",
        "Hard requirements:",
        "- [fact:f8] Remote only",
        "Soft preferences:",
        "- [fact:f7] Small teams",
      ].join("\n"),
    );
  });
});

describe("profileLearningHint", () => {
  const facts = (n: number, kind: ProfileFact["kind"] = "soft_preference") =>
    Array.from({ length: n }, (_, i) => fact(`f${i}`, kind, `Fact ${i}`));

  it("asks to learn while the profile is empty or small", () => {
    expect(profileLearningHint([])).toMatch(/still thin \(0 facts, no hard requirements\)/);
    expect(profileLearningHint(facts(2, "hard_requirement"))).toMatch(/still thin \(2 facts\)/);
  });

  it("asks while there is no hard requirement, however many facts", () => {
    expect(profileLearningHint(facts(10))).toMatch(/no hard requirements/);
  });

  it("stops once the profile has enough facts and a hard requirement", () => {
    const enough = [...facts(THIN_PROFILE_FACTS - 1), fact("h", "hard_requirement", "Remote")];
    expect(profileLearningHint(enough)).toBeNull();
  });
});
