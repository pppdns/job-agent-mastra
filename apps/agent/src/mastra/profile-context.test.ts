import type { ProfileFact } from "@copilot/db";
import { describe, expect, it } from "vitest";
import { formatProfile } from "./profile-context";

const fact = (id: string, kind: ProfileFact["kind"], text: string) =>
  ({
    id,
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

  it("groups facts by kind with their ids", () => {
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
        "- [fact:a] Remote only",
        "Soft preferences:",
        "- [fact:b] Small teams",
      ].join("\n"),
    );
  });
});
