import { describe, expect, it } from "vitest";
import {
  assessmentSchema,
  assessmentSummary,
  DEFAULT_RESEARCH_TOPICS,
  modelAssessmentSchema,
  moneyAmounts,
  normalizeModelAssessment,
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
  const listing = [
    "Salary range EUR 75,000 – 90,000 per year, or £62.000 in London. Contractors: EUR 50.25 / hour.",
  ];
  it("accepts amounts copied or abbreviated from the listing", () => {
    expect(salaryFiguresMissing("EUR 75,000 – 90,000 / year", listing)).toEqual([]);
    expect(salaryFiguresMissing("€75k–90k", listing)).toEqual([]);
    expect(salaryFiguresMissing("€75–90k", listing)).toEqual([]);
    expect(salaryFiguresMissing("£62,000", listing)).toEqual([]);
    expect(salaryFiguresMissing("EUR 50.25/h", listing)).toEqual([]);
  });
  it("names amounts the listing doesn't state", () => {
    expect(salaryFiguresMissing("EUR 80,000 – 90,000", listing)).toEqual(["80,000"]);
    expect(salaryFiguresMissing("EUR 7.5k", listing)).toEqual(["7.5k"]);
    expect(salaryFiguresMissing("EUR 75k", ["EUR 750,000"])).toEqual(["75k"]);
    expect(salaryFiguresMissing("EUR 25.50 / hour", ["EUR 50.25 / hour"])).toEqual(["25.50"]);
  });
});

describe("moneyAmounts", () => {
  it("parses separators, decimals and multipliers", () => {
    expect(moneyAmounts("1.234,56 · 1,500 · 1.2M · 75 kr").map((a) => a.value)).toEqual([
      1234.56, 1500, 1_200_000, 75,
    ]);
    expect(moneyAmounts("Competitive")).toEqual([]);
  });
});

describe("normalizeModelAssessment", () => {
  it("drops an empty salary and cuts an over-long headline at a word", () => {
    const long = `${"Senior backend role at a growing startup ".repeat(5)}end`;
    const result = normalizeModelAssessment({ ...minimal, headline: long, salary: " " } as never);
    expect(result.salary).toBeUndefined();
    expect(result.headline?.length).toBeLessThanOrEqual(140);
    expect(result.headline?.endsWith("…")).toBe(true);
    expect(result.headline).not.toMatch(/\s…$/);
    expect(normalizeModelAssessment({ ...minimal, headline: "Short" } as never).headline).toBe(
      "Short",
    );
    // An over-long salary is still rejected by the model schema, so Mastra's retry fixes it.
    expect(modelAssessmentSchema.safeParse({ ...minimal, salary: "x".repeat(121) }).success).toBe(
      false,
    );
    expect(modelAssessmentSchema.safeParse({ ...minimal, salary: "" }).success).toBe(true);
  });
});
