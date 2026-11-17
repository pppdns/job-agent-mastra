import type { EligibilityDecision, ListingFacts } from "@copilot/shared";
import { and, desc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "./index";
import { jobs } from "./schema";
import { serializeWrites } from "./write-lock";

// Listing facts per job (`ListingFacts`, extracted once per listing version by the fast model,
// verified by app code) and the location eligibility code decides from them.

/**
 * The listing doesn't rule out home. Jobs without a decision yet (no facts, or no home in the
 * preferences) fall back to the older location block, until the facts backfill reaches them.
 */
export const locationOpen = sql`(CASE WHEN ${jobs.eligibility} IS NOT NULL
  THEN ${jobs.eligibility} NOT IN ('closed', 'likely_closed')
  ELSE ${jobs.locationBlock} IS NULL END)`;

/** A stored listing to read facts from (a research page counts only as the job's own URL). */
const hasListing = sql`EXISTS (SELECT 1 FROM app_sources s WHERE s.job_id = "app_jobs"."id"
  AND (s.kind != 'web' OR s.url = "app_jobs"."canonical_url"))`;

/** Jobs a user could see: chat jobs, acted on or kept, or discovered with a passing posting. */
const worthFacts = sql`(${jobs.origin} = 'chat' OR ${jobs.status} != 'new' OR ${jobs.keptAt} IS NOT NULL
  OR EXISTS (SELECT 1 FROM app_postings p WHERE p.job_id = "app_jobs"."id" AND p.screen_reasons IS NULL))`;

/** Discovered jobs still waiting for triage, or jobs the user deals with (chat, acted, kept). */
const beforeTriage = sql`(${jobs.origin} = 'chat' OR ${jobs.status} != 'new' OR ${jobs.keptAt} IS NOT NULL OR ${jobs.triageScore} IS NULL)`;

const awaiting = (version: number, untriagedOnly = false) =>
  and(
    isNull(jobs.archivedAt),
    or(isNull(jobs.factsVersion), lt(jobs.factsVersion, version)),
    worthFacts,
    hasListing,
    untriagedOnly ? beforeTriage : undefined,
  );

export type ExtractionCandidate = { id: string; title: string | null; company: string | null };

/**
 * Jobs whose facts are missing or older than `version`, ones the user already deals with
 * first, then newest first.
 */
export async function jobsAwaitingExtraction(
  db: Db,
  input: {
    version: number;
    limit: number;
    /** Only jobs triage will look at next (and the user's own); the backfill takes all. */
    untriagedOnly?: boolean;
  },
): Promise<ExtractionCandidate[]> {
  if (input.limit <= 0) return [];
  return db
    .select({ id: jobs.id, title: jobs.title, company: jobs.company })
    .from(jobs)
    .where(awaiting(input.version, input.untriagedOnly))
    .orderBy(
      sql`(${jobs.origin} = 'chat' OR ${jobs.status} != 'new' OR ${jobs.keptAt} IS NOT NULL) DESC`,
      desc(jobs.createdAt),
    )
    .limit(input.limit);
}

export async function countAwaitingExtraction(db: Db, version: number): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(jobs).where(awaiting(version));
  return row?.n ?? 0;
}

/** Stores a job's verified facts and the eligibility decided from them (null without a home). */
export function saveFacts(
  db: Db,
  jobId: string,
  input: { facts: ListingFacts; version: number; decision: EligibilityDecision | null },
): Promise<void> {
  return serializeWrites(db, async () => {
    await db
      .update(jobs)
      .set({
        facts: input.facts,
        factsVersion: input.version,
        extractedAt: new Date(),
        eligibility: input.decision?.eligibility ?? null,
        eligibilityQuote: input.decision?.quote ?? null,
      })
      .where(eq(jobs.id, jobId));
  });
}

/**
 * Decides every stored job's eligibility again (after home changed): code only, no model.
 * `decide` returns null when there is no home. Returns how many jobs changed.
 */
export function rederiveEligibility(
  db: Db,
  decide: (facts: ListingFacts) => EligibilityDecision | null,
): Promise<number> {
  return serializeWrites(db, async () => {
    const rows = await db
      .select({
        id: jobs.id,
        facts: jobs.facts,
        eligibility: jobs.eligibility,
        quote: jobs.eligibilityQuote,
      })
      .from(jobs)
      .where(isNotNull(jobs.facts));
    let changed = 0;
    await db.transaction(async (tx) => {
      for (const row of rows) {
        if (!row.facts) continue;
        const next = decide(row.facts);
        const eligibility = next?.eligibility ?? null;
        const quote = next?.quote ?? null;
        if (eligibility === row.eligibility && quote === row.quote) continue;
        await tx
          .update(jobs)
          .set({ eligibility, eligibilityQuote: quote })
          .where(eq(jobs.id, row.id));
        changed += 1;
      }
    });
    return changed;
  });
}
