import { describe, expect, it } from "vitest";
import {
  assessmentSchema,
  assessmentSummary,
  DEFAULT_RESEARCH_TOPICS,
  researchRequestText,
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

  it("names the job id and topics in the request", () => {
    expect(
      researchRequestText({
        jobId: "j1",
        company: "Acme",
        topics: ["business_health", "role_facts"],
      }),
    ).toBe("Research Acme (job j1): business health, role-specific facts.");
    expect(researchRequestText({ jobId: "j1", company: null, topics: ["business"] })).toBe(
      "Research the company (job j1): what the company does.",
    );
  });
});
