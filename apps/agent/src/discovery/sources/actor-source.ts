import {
  companyKey,
  type DiscoverySource,
  normalizeText,
  type PostingInput,
  screenPosting,
} from "@copilot/shared";
import {
  CooldownError,
  type FetchContext,
  type FetchOutcome,
  type JobSource,
  type ProviderRun,
  rawSampler,
  SourceError,
  timeLeftMs,
  timeLimitFailure,
} from "../types";
import type { ActorPrices, ApifyRunner } from "./apify";

// A board read through an Apify Store actor: a pure input builder (one actor run per search),
// a pure item parser, and this loop. Runs go one by one until the source's per-run cap is spent;
// a failed search never loses the others, a bad key or an exhausted account stops the source.

export type ActorSearch = {
  /** Shown in failures, e.g. `"AI Engineer"`. */
  label: string;
  input: unknown;
};

export type ActorBoard = {
  id: DiscoverySource;
  actorId: string;
  /** Event prices (USD), only used when a run doesn't report its own cost. */
  prices: ActorPrices;
  timeoutSecs?: number;
  searches(context: FetchContext): ActorSearch[];
  parse(raw: unknown): PostingInput | null;
  /**
   * Keep one posting per company and title within a run (a feed listing the same role once per
   * office would otherwise become one job per office): the first variant that passes the screen,
   * else the first one, so an eligible office is never dropped for an ineligible one.
   */
  onePerTitle?: boolean;
};

const RUN_TIMEOUT_SECS = 300;
/** A search needs at least this much of the source's time left to start. */
const MIN_SEARCH_SECS = 120;
/** The runner may wait this long past an actor's timeout (its own deadline plus one poll). */
const RUNNER_SLACK_SECS = 120;

export function createActorSource(board: ActorBoard, runActor: ApifyRunner | null): JobSource {
  return {
    id: board.id,
    paid: true,
    unavailable: () => (runActor ? null : "APIFY_API_KEY is not set"),
    async fetch(context): Promise<FetchOutcome> {
      if (!runActor) throw new SourceError("APIFY_API_KEY is not set");
      const searches = board.searches(context);
      const byId = new Map<string, PostingInput>();
      let invalid = 0;
      let costUsd = 0;
      const failures: string[] = [];
      const notes: string[] = [];
      let succeeded = 0;
      const raws = rawSampler();
      const providerRuns: ProviderRun[] = [];
      /** Company + title → the kept variant's id, and whether it passes the screen. */
      const titles = new Map<string, { id: string; pass: boolean }>();
      for (const [i, search] of searches.entries()) {
        const remaining = context.maxUsd - costUsd;
        if (remaining < 0.01) {
          notes.push(`spend cap reached after ${costUsd.toFixed(2)} USD`);
          break;
        }
        const leftSecs = Math.floor(timeLeftMs(context) / 1_000);
        if (leftSecs < MIN_SEARCH_SECS) {
          failures.push(timeLimitFailure(searches.length - i, searches.length));
          break;
        }
        try {
          const result = await runActor(board.actorId, search.input, {
            maxUsd: remaining,
            // Shortened so the run ends (TIMED-OUT keeps its items) within the source's time.
            timeoutSecs: Math.min(
              board.timeoutSecs ?? RUN_TIMEOUT_SECS,
              Math.max(60, leftSecs - RUNNER_SLACK_SECS),
            ),
            prices: board.prices,
            signal: context.signal,
          });
          costUsd += result.costUsd;
          if (result.runId && result.datasetId) {
            providerRuns.push({
              label: search.label,
              runId: result.runId,
              datasetId: result.datasetId,
            });
          }
          if (result.partial) failures.push(result.partial);
          else succeeded += 1;
          for (const raw of result.items) {
            const posting = board.parse(raw);
            if (!posting) {
              invalid += 1;
              raws.invalid(raw);
              continue;
            }
            raws.valid(raw);
            if (board.onePerTitle) {
              const key = `${companyKey(posting.company)}|${normalizeText(posting.title)}`;
              const pass = screenPosting(context.settings, posting).pass;
              const kept = titles.get(key);
              if (kept && (kept.pass || !pass)) continue;
              if (kept) byId.delete(kept.id);
              titles.set(key, { id: posting.externalId, pass });
            }
            // Kept whatever its date (it's paid for): the screen's age limit drops old ones.
            byId.set(posting.externalId, posting);
          }
        } catch (error) {
          if (context.signal?.aborted) throw error;
          const message = error instanceof Error ? error.message : "failed";
          // The key or the account is the problem: no point in trying the other searches.
          if (/401|402/.test(message)) throw new SourceError(message);
          failures.push(`${search.label}: ${message}`);
          // Rate limited for longer than we retry: stop asking for this run.
          if (error instanceof CooldownError) break;
        }
      }
      if (succeeded === 0 && byId.size === 0 && failures.length > 0) {
        throw new SourceError(`no search succeeded (${failures[0]})`);
      }
      const partial = [...failures, ...notes];
      return {
        postings: [...byId.values()],
        invalid,
        costUsd,
        partial: partial.length > 0 ? partial.slice(0, 5).join("; ") : undefined,
        failures,
        raw: raws.items(),
        providerRuns,
      };
    },
  };
}

/** Days between `since` and now, rounded up (at least 1). */
export const daysSince = (since: Date, now: Date = new Date()) =>
  Math.max(1, Math.ceil((now.getTime() - since.getTime()) / 86_400_000));

/** The smallest of a board's posted-within windows (days) that covers `since`, else the largest. */
export function windowFor(since: Date, windows: readonly number[], now: Date = new Date()) {
  const days = daysSince(since, now);
  return windows.find((w) => w >= days) ?? windows[windows.length - 1] ?? days;
}
