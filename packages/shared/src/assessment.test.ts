import { describe, expect, it } from "vitest";
import { assessmentSchema, assessmentSummary } from "./assessment";

const minimal = {
  overview: "Platform role at a robotics company.",
  fitBasis: "role_only",
  recommendation: { verdict: "investigate_further", rationale: "Pay and on-call are unknown." },
};

describe("assessmentSchema", () => {
  it("fills empty lists for a minimal assessment", () => {
    const parsed = assessmentSchema.parse(minimal);
    expect(parsed.strengths).toEqual([]);
    expect(parsed.recommendation.nextSteps).toEqual([]);
  });

  it("rejects a numeric score in place of a verdict", () => {
    const result = assessmentSchema.safeParse({
      ...minimal,
      recommendation: { verdict: 8.5, rationale: "x" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown evidence classes", () => {
    const result = assessmentSchema.safeParse({
      ...minimal,
      strengths: [{ text: "Great culture", evidence: "vibes" }],
    });
    expect(result.success).toBe(false);
  });

  it("summarizes with the headline, or the overview's first sentence for older drafts", () => {
    const parsed = assessmentSchema.parse({ ...minimal, overview: "First. Second." });
    expect(assessmentSummary(parsed).headline).toBe("First.");
    const withHeadline = assessmentSchema.parse({ ...minimal, headline: "Gist" });
    expect(assessmentSummary(withHeadline).headline).toBe("Gist");
  });

  it("hides a fit level unless the profile informed the assessment", () => {
    const parsed = assessmentSchema.parse({ ...minimal, fitLevel: "strong" });
    expect(assessmentSummary(parsed).fitLevel).toBeUndefined();
  });
});
