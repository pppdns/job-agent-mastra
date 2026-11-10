import {
  companyKey,
  type DiscoverySource,
  normalizeText,
  type PostingInput,
} from "@copilot/shared";
import {
  CooldownError,
  type FetchContext,
  type FetchOutcome,
  type JobSource,
  SourceError,
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
   * office would otherwise become one job per office).
   */
  onePerTitle?: boolean;
};

const RUN_TIMEOUT_SECS = 300;

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
      const titles = new Set<string>();
      for (const search of searches) {
        const remaining = context.maxUsd - costUsd;
        if (remaining < 0.01) {
          notes.push(`spend cap reached after ${costUsd.toFixed(2)} USD`);
          break;
        }
        try {
          const result = await runActor(board.actorId, search.input, {
            maxUsd: remaining,
            timeoutSecs: board.timeoutSecs ?? RUN_TIMEOUT_SECS,
            prices: board.prices,
            signal: context.signal,
          });
          costUsd += result.costUsd;
          if (result.partial) failures.push(result.partial);
          else succeeded += 1;
          for (const raw of result.items) {
            const posting = board.parse(raw);
            if (!posting) {
              invalid += 1;
              continue;
            }
            if (board.onePerTitle) {
              const key = `${companyKey(posting.company)}|${normalizeText(posting.title)}`;
              if (titles.has(key)) continue;
              titles.add(key);
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
