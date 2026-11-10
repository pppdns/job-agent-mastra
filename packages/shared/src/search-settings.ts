import { z } from "zod";

// The user's structured search criteria: what the sources are asked for and what the
// deterministic screen throws out. Stored as one JSON row; parsed with defaults so older rows
// keep working when fields are added.

const phrases = (max: number) => z.array(z.string().trim().min(1).max(100)).max(max);
/** Feed category slugs as they appear in the board's feed URLs. */
const slugs = (fallback: string[]) =>
  z
    .array(
      z
        .string()
        .trim()
        .regex(/^[a-z0-9-]{1,80}$/),
    )
    .max(20)
    .default(fallback);
const feed = z.object({ enabled: z.boolean().default(true) }).prefault({});
/** A board read through an Apify actor: on/off, results per search and a per-run spend cap. */
const actorBoard = (enabled: boolean, limit: number, maxUsd: number) =>
  z
    .object({
      enabled: z.boolean().default(enabled),
      /** Results per search (Apify bills per result). */
      limitPerSearch: z.number().int().min(1).max(200).default(limit),
      /** Hard cap on what one run may spend on this board (USD). */
      maxUsdPerRun: z.number().min(0.01).max(20).default(maxUsd),
    })
    .prefault({});

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
  /** Triage score (0–100) a job needs to be shown. */
  triageThreshold: z.number().int().min(0).max(100).default(60),
  /** Full assessments per run for the best new matches. */
  maxAssessmentsPerRun: z.number().int().min(0).max(50).default(15),
  /** Most jobs triaged per run; the rest wait for the next run (newest first). */
  maxTriagePerRun: z.number().int().min(0).max(2_000).default(400),
  /** Hard cap on what one run may spend on models: triage plus assessments (USD). */
  maxLlmUsdPerRun: z.number().min(0).max(50).default(2),
  sources: z
    .object({
      himalayas: z
        .object({
          enabled: z.boolean().default(true),
          /** Result pages (20 jobs each) read per query and run. */
          maxPages: z.number().int().min(1).max(10).default(3),
        })
        .prefault({}),
      weworkremotely: z
        .object({
          enabled: z.boolean().default(true),
          /** RSS categories read each run (`weworkremotely.com/categories/<slug>.rss`). */
          categories: slugs([
            "remote-full-stack-programming-jobs",
            "remote-back-end-programming-jobs",
            "remote-front-end-programming-jobs",
            "remote-devops-sysadmin-jobs",
          ]),
        })
        .prefault({}),
      /** The latest ~100 jobs of every kind (no search); the screen and triage sort them. */
      remoteok: feed,
      /** A small, 24h-delayed set (no search). */
      remotive: feed,
      nodesk: z
        .object({
          enabled: z.boolean().default(true),
          /** RSS categories read each run (`nodesk.co/remote-jobs/<slug>/index.xml`). */
          categories: slugs(["engineering"]),
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
      /** YC's Work at a Startup (about $0.10 per 1,000 results; one run for all phrases). */
      ycombinator: actorBoard(true, 50, 0.05),
      /** Jobgether, remote-first (about $0.10 per 1,000; one run for all phrases). */
      jobgether: actorBoard(true, 50, 0.05),
      /** Dice, US tech (about $1 per 1,000; mostly on-site US roles, which the screen drops). */
      dice: actorBoard(false, 25, 0.1),
      /** Built In (about $1.07 per 1,000, billed in pages of 25; one run for all phrases). */
      builtin: actorBoard(true, 25, 0.15),
      /** Wellfound, startups (about $2.80 per 1,000; searched by role pages, ~30 per page). */
      wellfound: z
        .object({
          enabled: z.boolean().default(true),
          /** Role slugs (`wellfound.com/role/r/<slug>`). */
          roles: slugs(["ai-engineer", "full-stack-engineer", "engineering-manager"]),
          maxUsdPerRun: z.number().min(0.01).max(20).default(0.15),
        })
        .prefault({}),
      /** HiringCafe, career-site jobs with ATS apply links (about $1.25 per 1,000; slow runs). */
      hiringcafe: actorBoard(true, 25, 0.15),
      /**
       * Company career sites on Greenhouse, Lever, Ashby, Workday and ~50 other ATS (Fantastic.jobs
       * feed, $0.002 per job, at least 200 per run). The feed returns every matching active job,
       * newest first, with no "since": 200 cover about 5 days, so it runs at most once a day.
       */
      careersites: z
        .object({
          enabled: z.boolean().default(true),
          /** Jobs per run (the actor's minimum is 200; repeats are billed too). */
          limit: z.number().int().min(200).max(1_000).default(200),
          maxUsdPerRun: z.number().min(0.01).max(20).default(0.45),
          /** Skip a run this soon after the last good one (hours; 0 = every run). */
          minHoursBetweenRuns: z.number().int().min(0).max(168).default(20),
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
