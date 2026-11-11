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
  profileFactIds: z
    .array(z.string().max(64))
    .max(5)
    .default([])
    .describe(
      "Handles (e.g. f7) of the approved profile facts this point compares the job against; such a point is a fit judgement, so its evidence is inference",
    ),
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

/** Personal fit, best first. Only set with `fitBasis: "with_profile"`. */
export const FIT_LEVELS = ["strong", "good", "mixed", "weak", "poor"] as const;
export type FitLevel = (typeof FIT_LEVELS)[number];

export const FIT_LEVEL_LABELS: Record<FitLevel, string> = {
  strong: "Strong fit",
  good: "Good fit",
  mixed: "Mixed fit",
  weak: "Weak fit",
  poor: "Poor fit",
};

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

const points = (max: number) => z.array(assessmentPointSchema).max(max).default([]);

/**
 * A job assessment. No numeric score: tradeoffs and uncertainty are explained in words;
 * `fitLevel` is a coarse 5-step judgement, only once the profile is known.
 * `fitBasis` separates understanding the role from assessing personal fit.
 * `headline` and `fitLevel` are optional so drafts saved before they existed still parse.
 */
export const assessmentSchema = z.object({
  headline: text(140)
    .optional()
    .describe(
      "Always set: one line with the gist, e.g. 'Senior IC backend role; 4 office days conflicts with remote'",
    ),
  overview: text(1500).describe("Short role and company overview"),
  salary: text(120)
    .optional()
    .describe(
      "Pay as the listing states it, figures copied as written, e.g. 'EUR 75,000 – 90,000 / year + equity'. Omit when no figure is stated ('competitive' is not one); never estimate",
    ),
  fitBasis: z
    .enum(["role_only", "with_profile"])
    .describe("role_only until the user's preferences are known"),
  fitLevel: z
    .enum(FIT_LEVELS)
    .optional()
    .describe("Required with fitBasis with_profile; omit with role_only"),
  strengths: points(10),
  weaknesses: points(10),
  hardConflicts: points(10).describe("Conflicts with the user's stated hard requirements"),
  softTradeoffs: points(10),
  unknowns: z
    .array(z.object({ question: text(300), whyItMatters: text(300) }))
    .max(10)
    .default([]),
  recruiterQuestions: z.array(text(300)).max(10).default([]),
  researchTopics: z
    .array(z.enum(RESEARCH_TOPICS))
    .max(3)
    .optional()
    .describe("1–3 research topics whose findings would most change the decision"),
  recommendation: z.object({
    verdict: z.enum(RECOMMENDATIONS),
    rationale: text(800),
    nextSteps: z.array(text(300)).max(5).default([]),
  }),
});
export type Assessment = z.infer<typeof assessmentSchema>;

const HEADLINE_MAX = 140;

/**
 * What the model is asked for when app code saves the result (re-score, discovery): the same
 * shape, but a headline over its limit or an empty salary doesn't fail the whole call. Those
 * failed about 1 in 100 assessments even after a retry; `normalizeModelAssessment` fixes them.
 */
export const modelAssessmentSchema = assessmentSchema.extend({
  headline: z
    .string()
    .optional()
    .describe(assessmentSchema.shape.headline.description ?? ""),
  salary: z
    .string()
    .optional()
    .describe(assessmentSchema.shape.salary.description ?? ""),
});

/** Drops an empty salary, cuts an over-long headline at a word, then applies the strict schema. */
export function normalizeModelAssessment(raw: z.input<typeof modelAssessmentSchema>): Assessment {
  const salary = raw.salary?.trim() || undefined;
  let headline = raw.headline?.trim() || undefined;
  if (headline && headline.length > HEADLINE_MAX) {
    const cut = headline.slice(0, HEADLINE_MAX - 1);
    const space = cut.lastIndexOf(" ");
    headline = `${(space > 80 ? cut.slice(0, space) : cut).replace(/[\s,;:–-]+$/, "")}…`;
  }
  return assessmentSchema.parse({ ...raw, headline, salary });
}

/** Shown as research suggestions when an assessment names none (drafts saved before the field). */
export const DEFAULT_RESEARCH_TOPICS: readonly ResearchTopic[] = [
  "business",
  "business_health",
  "engineering",
];

/** Topics to offer as "research next" buttons for an assessment. */
export const suggestedResearchTopics = (a: Pick<Assessment, "researchTopics">): ResearchTopic[] =>
  a.researchTopics?.length ? [...new Set(a.researchTopics)] : [...DEFAULT_RESEARCH_TOPICS];

/**
 * The chat message a research button sends: only the job id and fixed topic labels. Never put
 * job fields (company, title) in it: they come from fetched listings, and text in a user
 * message counts as the user's own request (e.g. for status changes). The id also lets a new
 * chat find the job (get_job).
 */
export function researchRequestText(job: {
  jobId: string;
  topics: readonly ResearchTopic[];
}): string {
  const labels = job.topics.map((t) => RESEARCH_TOPIC_LABELS[t].toLowerCase()).join(", ");
  return `Research the company for job ${job.jobId}: ${labels}.`;
}

// A number: thousands groups ("75,000", "62.000", "1 234") then optional decimals, or plain
// digits with optional decimals ("25.50"); then an optional k/m multiplier ("75k", "1.2M").
const AMOUNT =
  /(\d{1,3}(?:[,.\u202f\u00a0' ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?:\s?([kKmM])(?![\p{L}]))?/gu;
const RANGE_GAP = /^\s*(?:-|–|—|to)\s*$/i;

type Amount = { raw: string; value: number };

/** Numeric amounts in a text. In "70–80k" the multiplier applies to both ends. */
export function moneyAmounts(text: string): Amount[] {
  const found = [...text.matchAll(AMOUNT)].map((m) => {
    const digits = m[1] ?? "";
    // A separator before exactly three digits groups thousands; any other one is decimal.
    const plain = digits.replace(/[,.\u202f\u00a0' ](?=\d{3}(?!\d))/g, "").replace(",", ".");
    return {
      raw: m[0],
      value: Number(plain),
      unit: m[2]?.toLowerCase(),
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
    };
  });
  found.forEach((a, i) => {
    const next = found[i + 1];
    if (!a.unit && next?.unit && RANGE_GAP.test(text.slice(a.end, next.start))) a.unit = next.unit;
  });
  const scale = { k: 1e3, m: 1e6 } as Record<string, number>;
  return found.map((a) => ({ raw: a.raw, value: a.value * (a.unit ? (scale[a.unit] ?? 1) : 1) }));
}

/**
 * Amounts in `salary` that appear in none of `texts` (e.g. the job's stored sources), compared
 * by value: "75k" matches "75,000" but not "750,000"; "25.50" doesn't match "50.25".
 */
export function salaryFiguresMissing(salary: string, texts: readonly string[]): string[] {
  const present = new Set(
    texts.flatMap((t) => moneyAmounts(t).map((a) => Math.round(a.value * 100))),
  );
  return moneyAmounts(salary)
    .filter((a) => !present.has(Math.round(a.value * 100)))
    .map((a) => a.raw.trim());
}

/** Every point in an assessment, for checks that apply to all of them. */
export const allPoints = (a: Assessment): AssessmentPoint[] => [
  ...a.strengths,
  ...a.weaknesses,
  ...a.hardConflicts,
  ...a.softTradeoffs,
];

/** At-a-glance numbers for lists and cards. */
export function assessmentSummary(a: Assessment) {
  return {
    headline: a.headline ?? firstSentence(a.overview),
    salary: a.salary,
    verdict: a.recommendation.verdict,
    fitBasis: a.fitBasis,
    fitLevel: a.fitBasis === "with_profile" ? a.fitLevel : undefined,
    counts: {
      hardConflicts: a.hardConflicts.length,
      weaknesses: a.weaknesses.length,
      softTradeoffs: a.softTradeoffs.length,
      strengths: a.strengths.length,
      unknowns: a.unknowns.length,
    },
  };
}
export type AssessmentSummary = ReturnType<typeof assessmentSummary>;

function firstSentence(text: string): string {
  const sentence = text.match(/^.+?[.!?](\s|$)/)?.[0]?.trim() ?? text;
  return sentence.length > 140 ? `${sentence.slice(0, 139)}…` : sentence;
}

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
