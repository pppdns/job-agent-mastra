import { z } from "zod";

/**
 * How strong the support for a claim is (brief: "Research scope"). `official` covers the
 * listing itself and the company's own sources.
 */
export const EVIDENCE_CLASSES = [
  "official",
  "independent",
  "anonymous",
  "inference",
  "unknown_conflicting",
] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

/** Classes that must cite at least one stored source. */
export const SOURCED_EVIDENCE_CLASSES: readonly EvidenceClass[] = [
  "official",
  "independent",
  "anonymous",
];

export const EVIDENCE_LABELS: Record<EvidenceClass, string> = {
  official: "Listing / official",
  independent: "Independent",
  anonymous: "Anonymous / weak",
  inference: "Inference",
  unknown_conflicting: "Unknown / conflicting",
};

const text = (max: number) => z.string().trim().min(1).max(max);

export const assessmentPointSchema = z.object({
  text: text(600),
  evidence: z.enum(EVIDENCE_CLASSES),
  sourceIds: z.array(z.string().max(64)).max(5).default([]),
  quote: z.string().trim().max(300).optional().describe("Short supporting quote from the source"),
});
export type AssessmentPoint = z.infer<typeof assessmentPointSchema>;

export const RECOMMENDATIONS = [
  "pursue",
  "consider",
  "investigate_further",
  "pass",
  "undecided",
] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  pursue: "Worth pursuing",
  consider: "Worth considering",
  investigate_further: "Investigate further",
  pass: "Probably pass",
  undecided: "Undecided",
};

const points = (max: number) => z.array(assessmentPointSchema).max(max).default([]);

/**
 * A job assessment. No numeric score: tradeoffs and uncertainty are explained in words.
 * `fitBasis` separates understanding the role from assessing personal fit.
 */
export const assessmentSchema = z.object({
  overview: text(1500).describe("Short role and company overview"),
  fitBasis: z
    .enum(["role_only", "with_profile"])
    .describe("role_only until the user's preferences are known"),
  strengths: points(10),
  weaknesses: points(10),
  hardConflicts: points(10).describe("Conflicts with the user's stated hard requirements"),
  softTradeoffs: points(10),
  unknowns: z
    .array(z.object({ question: text(300), whyItMatters: text(300) }))
    .max(10)
    .default([]),
  recruiterQuestions: z.array(text(300)).max(10).default([]),
  recommendation: z.object({
    verdict: z.enum(RECOMMENDATIONS),
    rationale: text(800),
    nextSteps: z.array(text(300)).max(5).default([]),
  }),
});
export type Assessment = z.infer<typeof assessmentSchema>;

/** Every point in an assessment, for checks that apply to all of them. */
export const allPoints = (a: Assessment): AssessmentPoint[] => [
  ...a.strengths,
  ...a.weaknesses,
  ...a.hardConflicts,
  ...a.softTradeoffs,
];

export const RESEARCH_TOPICS = [
  "business",
  "product",
  "engineering",
  "learning_ownership",
  "business_health",
  "role_facts",
] as const;
export type ResearchTopic = (typeof RESEARCH_TOPICS)[number];

export const RESEARCH_TOPIC_LABELS: Record<ResearchTopic, string> = {
  business: "What the company does",
  product: "Product and mission",
  engineering: "Engineering",
  learning_ownership: "Learning and ownership",
  business_health: "Business health",
  role_facts: "Role-specific facts",
};

const isoDate = z
  .string()
  .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, "YYYY, YYYY-MM or YYYY-MM-DD")
  .optional();

/** One researched claim. Publication date (of the source) and event date are kept apart. */
export const claimInputSchema = z.object({
  topic: z.enum(RESEARCH_TOPICS),
  text: z.string().trim().min(5).max(600),
  evidence: z.enum(EVIDENCE_CLASSES),
  sourceIds: z.array(z.string().max(64)).max(5).default([]),
  quote: z.string().trim().max(300).optional(),
  publishedAt: isoDate.describe("When the source was published"),
  eventDate: isoDate.describe("When the described event happened, if different"),
});
export type ClaimInput = z.infer<typeof claimInputSchema>;
