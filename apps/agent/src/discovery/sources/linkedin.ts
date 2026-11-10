import {
  type PostingInput,
  postingInputSchema,
  type SalaryPeriod,
  type SearchSettings,
} from "@copilot/shared";
import { htmlToText, httpUrl, plainMarkdown, str } from "../text";
import { type FetchContext, type FetchOutcome, type JobSource, SourceError } from "../types";
import type { ActorPrices, ApifyRunner } from "./apify";

// LinkedIn via the Apify actor `valig/linkedin-jobs-scraper` (pay per result; guest job search).
// LinkedIn's guest data has no reliable remote flag (the workplace URL filter is ignored), so
// remote stays unknown unless the location says so: the screen passes it and triage reads the
// description. Searches run one by one until the source's per-run cap is spent.

export const LINKEDIN_ACTOR = "valig/linkedin-jobs-scraper";

/** Bronze-tier event prices (Apify Store, 2026-11-10); only used to estimate cost. */
export const LINKEDIN_PRICES: ActorPrices = { result: 0.00036, "apify-actor-start": 0.0009 };

const BACKFILL_LIMIT_FACTOR = 4;
const BACKFILL_USD_FACTOR = 4;
const MAX_SKIP_IDS = 1_000;
const RUN_TIMEOUT_SECS = 300;
const HOUR_MS = 3_600_000;

/** LinkedIn's posting-age filter that covers everything since `since`. */
export function datePostedFor(since: Date, now: Date = new Date()): string {
  const hours = (now.getTime() - since.getTime()) / HOUR_MS;
  if (hours <= 24) return "r86400";
  if (hours <= 24 * 7) return "r604800";
  return "r2592000";
}

export type LinkedInSearch = {
  keywords: string;
  location: string;
  datePosted: string;
  limit: number;
  titleExclude: string[];
  skipJobId: string[];
};

/** One actor input per query × location. */
export function linkedInSearches(
  settings: SearchSettings,
  context: Pick<FetchContext, "since" | "backfill" | "knownIds">,
  now: Date = new Date(),
): LinkedInSearch[] {
  const { locations, limitPerSearch } = settings.sources.linkedin;
  const limit = Math.min(500, limitPerSearch * (context.backfill ? BACKFILL_LIMIT_FACTOR : 1));
  return settings.queries.flatMap((keywords) =>
    locations.map((location) => ({
      keywords,
      location,
      datePosted: datePostedFor(context.since, now),
      limit,
      titleExclude: settings.titleExclude,
      skipJobId: context.knownIds.slice(0, MAX_SKIP_IDS),
    })),
  );
}

/** Per-run spend cap of the LinkedIn source (raised for a backfill). */
export const linkedInMaxUsd = (settings: SearchSettings, backfill: boolean) =>
  settings.sources.linkedin.maxUsdPerRun * (backfill ? BACKFILL_USD_FACTOR : 1);

const CURRENCIES: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP", "₹": "INR" };
const PERIODS: Record<string, SalaryPeriod> = {
  yr: "year",
  year: "year",
  mo: "month",
  month: "month",
  wk: "week",
  week: "week",
  day: "day",
  hr: "hour",
  hour: "hour",
};

/** "€65,000.00/yr - €130,000.00/yr" → range, currency and period. */
export function parseLinkedInSalary(text: string | null) {
  const empty = { min: null, max: null, currency: null, period: null } as const;
  if (!text) return empty;
  const amounts = [...text.matchAll(/([€$£₹]|[A-Z]{3})\s?([\d,]+(?:\.\d+)?)\s*(K)?/g)];
  if (amounts.length === 0) return empty;
  const values = amounts.map((m) => Number((m[2] ?? "").replace(/,/g, "")) * (m[3] ? 1_000 : 1));
  const symbol = amounts[0]?.[1] ?? "";
  const period = PERIODS[text.match(/\/\s*([a-z]+)/i)?.[1]?.toLowerCase() ?? ""] ?? null;
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    currency: CURRENCIES[symbol] ?? (symbol.length === 3 ? symbol : null),
    period,
  };
}

/** One actor dataset item as a posting, or null when it lacks what a posting needs. */
export function parseLinkedInItem(raw: unknown): PostingInput | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const id = str(item.id, 50);
  if (!id || !/^\d+$/.test(id)) return null;
  const salaryText = str(item.salary, 200);
  const salary = parseLinkedInSalary(salaryText);
  const location = str(item.location);
  const posted = str(item.postedDate);
  const postedAt = posted ? new Date(posted) : null;
  const html = typeof item.descriptionHtml === "string" ? item.descriptionHtml : "";
  const text = typeof item.description === "string" ? item.description : "";
  const parsed = postingInputSchema.safeParse({
    source: "linkedin",
    externalId: id,
    url: `https://www.linkedin.com/jobs/view/${id}/`,
    applyUrl: httpUrl(item.applyUrl),
    title: str(item.title),
    company: str(item.companyName, 200),
    location,
    remote: location && /\bremote\b/i.test(location) ? true : null,
    regions: [],
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
    salaryPeriod: salary.period,
    salaryText,
    seniority: str(item.experienceLevel, 100),
    employmentType: str(item.contractType, 100),
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
    description: html ? htmlToText(html) : plainMarkdown(text),
  });
  return parsed.success ? parsed.data : null;
}

export function createLinkedInSource(runActor: ApifyRunner | null): JobSource {
  return {
    id: "linkedin",
    paid: true,
    unavailable: () => (runActor ? null : "APIFY_API_KEY is not set"),
    async fetch(context): Promise<FetchOutcome> {
      if (!runActor) throw new SourceError("APIFY_API_KEY is not set");
      const searches = linkedInSearches(context.settings, context);
      const byId = new Map<string, PostingInput>();
      let invalid = 0;
      let costUsd = 0;
      const problems: string[] = [];
      for (const search of searches) {
        const remaining = context.maxUsd - costUsd;
        if (remaining < 0.01) {
          problems.push(`spend cap reached after ${costUsd.toFixed(2)} USD`);
          break;
        }
        try {
          const result = await runActor(LINKEDIN_ACTOR, search, {
            maxUsd: remaining,
            timeoutSecs: RUN_TIMEOUT_SECS,
            prices: LINKEDIN_PRICES,
            signal: context.signal,
          });
          costUsd += result.costUsd;
          if (result.partial) problems.push(result.partial);
          for (const raw of result.items) {
            const posting = parseLinkedInItem(raw);
            if (posting) byId.set(posting.externalId, posting);
            else invalid += 1;
          }
        } catch (error) {
          if (context.signal?.aborted) throw error;
          const message = error instanceof Error ? error.message : "failed";
          // The key or the account is the problem: no point in trying the other searches.
          if (/401|402/.test(message)) throw new SourceError(message);
          problems.push(`"${search.keywords}" in ${search.location}: ${message}`);
        }
      }
      if (byId.size === 0 && problems.length > 0 && problems.length >= searches.length) {
        throw new SourceError(`every search failed (${problems[0]})`);
      }
      return {
        postings: [...byId.values()],
        invalid,
        costUsd,
        partial: problems.length > 0 ? problems.slice(0, 5).join("; ") : undefined,
      };
    },
  };
}
