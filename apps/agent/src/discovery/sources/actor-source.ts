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
// a pure item parser, and this loop. Runs go one by one (or a few at a time, `concurrency`) until
// the source's per-run cap is spent; a failed search never loses the others, a bad key or an
// exhausted account stops the source.

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
  /**
   * Searches run this many at a time (default 1), each with an equal share of what's left of the
   * cap, so together they never spend more. For slow actors that would otherwise hit the
   * source's time limit (HiringCafe: ~3 min per phrase).
   */
  concurrency?: number;
  /** The actor's error when a search matched nothing: that FAILED run counts as empty. */
  emptyRunError?: RegExp;
  /**
   * Run a search again (once) when its run timed out without a single item: the actor stalled
   * at startup (Jobgether: 3 of 9 runs on 2026-11-16 hung right after starting). Use with a short
   * `timeoutSecs`, so a stall costs little time.
   */
  retryStalledRuns?: boolean;
};

const RUN_TIMEOUT_SECS = 300;
/** A search needs at least this much of the source's time left to start. */
const MIN_SEARCH_SECS = 120;
/** The runner may wait this long past an actor's timeout (its own deadline plus one poll). */
const RUNNER_SLACK_SECS = 120;
/** A source with this many searches (one per phrase) is never empty on all of them by chance. */
const MIN_SEARCHES_FOR_EMPTY = 3;

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
      let returned = 0;
      /** Searches the actor itself said matched nothing (`emptyRunError`): a quiet window. */
      let emptyByActor = 0;
      const raws = rawSampler();
      const providerRuns: ProviderRun[] = [];
      /** Company + title → the kept variant's id, and whether it passes the screen. */
      const titles = new Map<string, { id: string; pass: boolean }>();
      const batchSize = Math.max(1, Math.floor(board.concurrency ?? 1));
      /** One search's result, handled in search order whatever order the batch finished in. */
      const handle = (
        search: ActorSearch,
        settled: PromiseSettledResult<Awaited<ReturnType<ApifyRunner>>>,
      ) => {
        if (settled.status === "rejected") {
          const error = settled.reason;
          if (context.signal?.aborted) throw error;
          const message = error instanceof Error ? error.message : "failed";
          // The key or the account is the problem: no point in trying the other searches.
          if (/401|402/.test(message)) throw new SourceError(message);
          failures.push(`${search.label}: ${message}`);
          // Rate limited for longer than we retry: stop asking for this run.
          return error instanceof CooldownError ? "stop" : "go";
        }
        const result = settled.value;
        costUsd += result.costUsd;
        if (result.runId && result.datasetId) {
          providerRuns.push({
            label: search.label,
            runId: result.runId,
            datasetId: result.datasetId,
          });
        }
        if (result.partial) failures.push(`${search.label}: ${result.partial}`);
        else succeeded += 1;
        returned += result.items.length;
        if (result.status === "FAILED") emptyByActor += 1;
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
        return "go";
      };
      const secsLeft = () => Math.floor(timeLeftMs(context) / 1_000);
      /** `leftSecs`: the source's time left when the search (or its batch) starts. */
      const runOnce = (search: ActorSearch, maxUsd: number, leftSecs: number) =>
        runActor(board.actorId, search.input, {
          maxUsd,
          // Shortened so the run ends (TIMED-OUT keeps its items) within the source's time.
          timeoutSecs: Math.min(
            board.timeoutSecs ?? RUN_TIMEOUT_SECS,
            Math.max(60, leftSecs - RUNNER_SLACK_SECS),
          ),
          prices: board.prices,
          signal: context.signal,
          emptyRunError: board.emptyRunError,
        });
      /** One search, run again once if it stalled (and the board allows it, and time is left). */
      const runSearch = async (search: ActorSearch, maxUsd: number, leftSecs: number) => {
        const first = await runOnce(search, maxUsd, leftSecs);
        const stalled = first.status === "TIMED-OUT" && first.items.length === 0;
        const left = maxUsd - first.costUsd;
        if (!board.retryStalledRuns || !stalled || left < 0.01 || secsLeft() < MIN_SEARCH_SECS) {
          return first;
        }
        // The stalled run is counted now, so its cost and run id stay recorded whatever the
        // retry does (a retry that throws would otherwise lose them).
        costUsd += first.costUsd;
        if (first.runId && first.datasetId) {
          providerRuns.push({
            label: `${search.label} (stalled)`,
            runId: first.runId,
            datasetId: first.datasetId,
          });
        }
        return runOnce(search, left, secsLeft());
      };
      for (let i = 0; i < searches.length; ) {
        context.onProgress?.(i, searches.length, (searches[i] as ActorSearch).label);
        const remaining = context.maxUsd - costUsd;
        if (remaining < 0.01) {
          notes.push(`spend cap reached after ${costUsd.toFixed(2)} USD`);
          break;
        }
        const leftSecs = secsLeft();
        if (leftSecs < MIN_SEARCH_SECS) {
          failures.push(timeLimitFailure(searches.length - i, searches.length));
          break;
        }
        // Each run in the batch gets an equal share of the cap (at least a cent each).
        const size = Math.max(
          1,
          Math.min(batchSize, searches.length - i, Math.floor(remaining / 0.01)),
        );
        const batch = searches.slice(i, i + size);
        const settled = await Promise.allSettled(
          batch.map((search) => runSearch(search, remaining / size, leftSecs)),
        );
        i += size;
        let stop = false;
        for (const [j, search] of batch.entries()) {
          if (handle(search, settled[j] as (typeof settled)[number]) === "stop") stop = true;
        }
        if (stop) break;
      }
      // Several broad searches all coming back empty is the actor misbehaving, not a quiet day
      // (seen: Dice returned nothing for all 7 phrases of a 30-day backfill). Reported as a
      // failure, so the run is partial: it's emailed and the next run asks for the window again.
      // Not when the actor said so itself: Jobgether's 1-day window is often empty for every phrase.
      if (
        searches.length >= MIN_SEARCHES_FOR_EMPTY &&
        succeeded === searches.length &&
        !returned &&
        emptyByActor === 0
      ) {
        failures.push(`every search came back empty (${searches.length} searches)`);
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
