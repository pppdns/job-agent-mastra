import { describe, expect, it } from "vitest";
import {
  assessmentSchema,
  assessmentSummary,
  DEFAULT_RESEARCH_TOPICS,
  researchRequestText,
  salaryFiguresMissing,
  suggestedResearchTopics,
} from "./assessment";

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

describe("research suggestions", () => {
  it("offers the assessment's own topics, else the defaults", () => {
    const named = assessmentSchema.parse({ ...minimal, researchTopics: ["engineering"] });
    expect(suggestedResearchTopics(named)).toEqual(["engineering"]);
    expect(suggestedResearchTopics(assessmentSchema.parse(minimal))).toEqual([
      ...DEFAULT_RESEARCH_TOPICS,
    ]);
  });

  it("rejects unknown topics and more than three", () => {
    expect(assessmentSchema.safeParse({ ...minimal, researchTopics: ["gossip"] }).success).toBe(
      false,
    );
    const four = ["business", "product", "engineering", "business_health"];
    expect(assessmentSchema.safeParse({ ...minimal, researchTopics: four }).success).toBe(false);
  });

  it("names only the job id and topic labels in the request", () => {
    expect(researchRequestText({ jobId: "j1", topics: ["business_health", "role_facts"] })).toBe(
      "Research the company for job j1: business health, role-specific facts.",
    );
  });
});

describe("salaryFiguresMissing", () => {
  const listing = ["Salary range EUR 75,000 – 90,000 per year, or £62.000 in London."];
  it("accepts figures copied or abbreviated from the listing", () => {
    expect(salaryFiguresMissing("EUR 75,000 – 90,000 / year", listing)).toEqual([]);
    expect(salaryFiguresMissing("€75k–90k", listing)).toEqual([]);
    expect(salaryFiguresMissing("£62,000", listing)).toEqual([]);
  });
  it("names figures the listing doesn't state", () => {
    expect(salaryFiguresMissing("EUR 80,000 – 90,000", listing)).toEqual(["80000"]);
    expect(salaryFiguresMissing("EUR 70k", [])).toEqual(["70"]);
  });
});
