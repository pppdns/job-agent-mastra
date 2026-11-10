import { z } from "zod";

// The user's structured search criteria: what the sources are asked for and what the
// deterministic screen throws out. Stored as one JSON row; parsed with defaults so older rows
// keep working when fields are added.

const phrases = (max: number) => z.array(z.string().trim().min(1).max(100)).max(max);

export const searchSettingsSchema = z.object({
  /** Search phrases sent to the sources (one query each). They never filter on their own. */
  queries: phrases(12).default([
    "Applied AI Engineer",
    "AI Engineer",
    "Founding Engineer",
    "Full Stack Engineer",
    "Engineering Team Lead",
  ]),
  /** A title containing every word of one of these phrases is screened out (whole words). */
  titleExclude: phrases(100).default([
    "intern",
    "internship",
    "working student",
    "werkstudent",
    "trainee",
    "apprentice",
    "junior",
    "graduate",
    "sales",
    "account executive",
    "recruiter",
    "talent acquisition",
  ]),
  /** Companies never shown (matched by company key, so legal suffixes don't matter). */
  blockedCompanies: phrases(200).default([]),
  /**
   * Where a remote role may be limited to. A remote posting restricted only to other places is
   * screened out; "Europe" / "European Union" also match European countries.
   */
  remoteRegions: phrases(50).default(["Worldwide", "Europe", "European Union", "United States"]),
  /** Places where a non-remote role is fine (a non-remote posting elsewhere is screened out). */
  onsitePlaces: phrases(50).default(["Budapest", "Hungary"]),
  /** Postings older than this are screened out (and the first run looks back this far). */
  maxAgeDays: z.number().int().min(1).max(90).default(14),
  /** Screens out postings whose stated pay tops out below this (only when pay is stated). */
  minSalary: z
    .object({ amount: z.number().positive(), currency: z.string().trim().length(3) })
    .nullable()
    .default(null),
  /** Triage score (0–100) a job needs to be shown (M14). */
  triageThreshold: z.number().int().min(0).max(100).default(60),
  /** Full assessments per run for the best new matches (M14). */
  maxAssessmentsPerRun: z.number().int().min(0).max(50).default(15),
  sources: z
    .object({
      himalayas: z
        .object({
          enabled: z.boolean().default(true),
          /** Result pages (20 jobs each) read per query and run. */
          maxPages: z.number().int().min(1).max(10).default(3),
        })
        .prefault({}),
      linkedin: z
        .object({
          enabled: z.boolean().default(true),
          /** LinkedIn locations searched for each query. */
          locations: phrases(10).default(["European Union", "United States", "Budapest"]),
          /** Results per query and location (Apify bills per result). */
          limitPerSearch: z.number().int().min(1).max(500).default(50),
          /** Hard cap on what one run may spend on this source (USD). */
          maxUsdPerRun: z.number().min(0.01).max(20).default(0.5),
        })
        .prefault({}),
    })
    .prefault({}),
  /** All Apify sources together stop for the month once this is spent (USD, last 30 days). */
  apifyMonthlyBudgetUsd: z.number().min(0).max(1_000).default(100),
});

export type SearchSettings = z.infer<typeof searchSettingsSchema>;

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = searchSettingsSchema.parse({});

/** Parses a stored row; anything unreadable falls back to the defaults field by field. */
export function parseSearchSettings(value: unknown): SearchSettings {
  const parsed = searchSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : DEFAULT_SEARCH_SETTINGS;
}
