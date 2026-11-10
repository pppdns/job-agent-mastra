import { type PostingInput, postingInputSchema, type SalaryPeriod } from "@copilot/shared";
import { htmlToText, httpUrl, num, str } from "../text";
import {
  CooldownError,
  type FetchContext,
  type FetchOutcome,
  type JobSource,
  rawSampler,
  SourceError,
  timeLeftMs,
  timeLimitFailure,
} from "../types";
import type { HttpJson } from "./http";

// Himalayas' official, free Remote Jobs API (https://himalayas.app/docs/remote-jobs-api).
// Terms: apply through `applicationLink` and show visible Himalayas credit. Data refreshes once a
// day, so more frequent runs only re-read cached pages.

const SEARCH_URL = "https://himalayas.app/jobs/api/search";
const BACKFILL_MAX_PAGES = 10;
/** Pause between requests: well under the keyed limit (60/min), polite on the shared one. */
export const HIMALAYAS_PAUSE_MS = 1_100;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

const PERIODS: Record<string, SalaryPeriod> = {
  hourly: "hour",
  daily: "day",
  weekly: "week",
  monthly: "month",
  annual: "year",
  yearly: "year",
};

const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** One job from the API as a posting, or null when it lacks what a posting needs. */
export function parseHimalayasJob(raw: unknown): PostingInput | null {
  if (!raw || typeof raw !== "object") return null;
  const job = raw as Record<string, unknown>;
  const guid = str(job.guid, 2_000);
  const url = httpUrl(job.guid) ?? httpUrl(job.applicationLink);
  if (!guid || !url) return null;
  const regions = Array.isArray(job.locationRestrictions)
    ? job.locationRestrictions.flatMap((r) => {
        const name = typeof r === "string" ? r : str((r as { name?: unknown })?.name, 100);
        return name ? [name] : [];
      })
    : [];
  const min = num(job.minSalary);
  const max = num(job.maxSalary);
  const currency = str(job.currency, 10);
  const periodName = str(job.salaryPeriod)?.toLowerCase() ?? "annual";
  const period = PERIODS[periodName] ?? null;
  const salaryText =
    min !== null || max !== null
      ? `${currency ?? ""} ${[min, max]
          .filter((n): n is number => n !== null)
          .map(money)
          .join("–")} per ${period ?? periodName}`.trim()
      : null;
  const pub = num(job.pubDate);
  const seniority = Array.isArray(job.seniority)
    ? job.seniority.filter((s) => typeof s === "string").join(", ")
    : str(job.seniority);
  const parsed = postingInputSchema.safeParse({
    source: "himalayas",
    externalId: guid.slice(0, 200),
    url,
    applyUrl: httpUrl(job.applicationLink),
    title: str(job.title),
    company: str(job.companyName, 200),
    location: regions.length > 0 ? `Remote (${regions.slice(0, 5).join(", ")})` : "Remote",
    remote: true,
    regions: regions.slice(0, 100),
    salaryMin: min,
    salaryMax: max ?? min,
    salaryCurrency: currency,
    salaryPeriod: period,
    salaryText,
    seniority: seniority || null,
    employmentType: str(job.employmentType, 100),
    postedAt: pub ? new Date(pub * 1000) : null,
    description: htmlToText(typeof job.description === "string" ? job.description : ""),
  });
  return parsed.success ? parsed.data : null;
}

export function createHimalayasSource(
  http: HttpJson,
  apiKey?: string,
  pauseMs: number = HIMALAYAS_PAUSE_MS,
): JobSource {
  return {
    id: "himalayas",
    paid: false,
    unavailable: () => null,
    async fetch(context: FetchContext): Promise<FetchOutcome> {
      const { settings, since, signal } = context;
      const maxPages = context.backfill ? BACKFILL_MAX_PAGES : settings.sources.himalayas.maxPages;
      const byId = new Map<string, PostingInput>();
      let invalid = 0;
      const raws = rawSampler();
      const failed: string[] = [];
      let requests = 0;
      let cooledDown = false;
      let timedOut = false;
      for (const [i, query] of settings.queries.entries()) {
        if (timeLeftMs(context) <= 0) {
          failed.push(timeLimitFailure(settings.queries.length - i, settings.queries.length));
          timedOut = true;
          break;
        }
        context.onProgress?.(i, settings.queries.length, `"${query}"`);
        try {
          for (let page = 1; page <= maxPages; page++) {
            if (requests++ > 0) await sleep(pauseMs, signal);
            // Out of time mid-search: keep the pages read so far.
            if (page > 1 && timeLeftMs(context) <= 0) break;
            const url = new URL(SEARCH_URL);
            url.searchParams.set("q", query);
            url.searchParams.set("sort", "recent");
            url.searchParams.set("page", String(page));
            const body = await http(url, {
              headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
              signal,
            });
            const jobs = (body as { jobs?: unknown })?.jobs;
            if (!Array.isArray(jobs))
              throw new SourceError("Himalayas returned an unexpected shape");
            let older = 0;
            for (const raw of jobs) {
              const posting = parseHimalayasJob(raw);
              if (!posting) {
                invalid += 1;
                raws.invalid(raw);
                continue;
              }
              raws.valid(raw);
              if (posting.postedAt && posting.postedAt < since) older += 1;
              else byId.set(posting.externalId, posting);
            }
            // Sorted by recency: once a page is all older than `since`, later pages are too.
            if (jobs.length === 0 || older === jobs.length) break;
          }
        } catch (error) {
          if (signal?.aborted) throw error;
          failed.push(`"${query}": ${error instanceof Error ? error.message : "failed"}`);
          // Rate limited for longer than we retry: stop asking for this run.
          if (error instanceof CooldownError) {
            cooledDown = true;
            break;
          }
        }
      }
      const allFailed = failed.length > 0 && failed.length === settings.queries.length;
      if (byId.size === 0 && (allFailed || cooledDown || timedOut)) {
        throw new SourceError(
          `${allFailed && !timedOut ? "every search failed" : "stopped"} (${failed[0]})`,
        );
      }
      return {
        postings: [...byId.values()],
        invalid,
        costUsd: 0,
        partial: failed.length > 0 ? `some searches failed: ${failed.join("; ")}` : undefined,
        failures: failed,
        raw: raws.items(),
      };
    },
  };
}
