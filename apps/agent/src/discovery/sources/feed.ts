import type { DiscoverySource, PostingInput } from "@copilot/shared";
import {
  CooldownError,
  type FetchContext,
  type FetchOutcome,
  type JobSource,
  rawSampler,
  SourceError,
} from "../types";

// A free feed source: a few fixed requests per run (a JSON API or RSS feeds), each returning raw
// items that a pure parser maps to postings. Feeds can't be asked "since when", and nothing is
// dropped by date here: some publish late with the original date (Remotive, 24 h), known
// postings are only marked seen, and the screen's age limit drops old ones. One failing request
// never loses the others.

export const FEED_PAUSE_MS = 1_000;

export type FeedRequest = {
  /** Shown in failures, e.g. a category name. */
  label: string;
  load(signal?: AbortSignal): Promise<unknown[]>;
};

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
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

export function createFeedSource(options: {
  id: DiscoverySource;
  requests(context: FetchContext): FeedRequest[];
  parse(raw: unknown): PostingInput | null;
  pauseMs?: number;
}): JobSource {
  const pauseMs = options.pauseMs ?? FEED_PAUSE_MS;
  return {
    id: options.id,
    paid: false,
    unavailable: () => null,
    async fetch(context): Promise<FetchOutcome> {
      const requests = options.requests(context);
      const byId = new Map<string, PostingInput>();
      const failures: string[] = [];
      let invalid = 0;
      let cooledDown = false;
      const raws = rawSampler();
      for (const [i, request] of requests.entries()) {
        if (i > 0) await sleep(pauseMs, context.signal);
        context.onProgress?.(i, requests.length, request.label);
        try {
          for (const raw of await request.load(context.signal)) {
            const posting = options.parse(raw);
            if (!posting) {
              invalid += 1;
              raws.invalid(raw);
            } else {
              raws.valid(raw);
              byId.set(posting.externalId, posting);
            }
          }
        } catch (error) {
          if (context.signal?.aborted) throw error;
          failures.push(`${request.label}: ${error instanceof Error ? error.message : "failed"}`);
          if (error instanceof CooldownError) {
            cooledDown = true;
            break;
          }
        }
      }
      const allFailed = failures.length > 0 && failures.length === requests.length;
      if (byId.size === 0 && (allFailed || cooledDown)) {
        throw new SourceError(
          `${allFailed ? "every request failed" : "stopped"} (${failures[0] ?? ""})`,
        );
      }
      return {
        postings: [...byId.values()],
        invalid,
        costUsd: 0,
        partial: failures.length > 0 ? `some requests failed: ${failures.join("; ")}` : undefined,
        failures,
        raw: raws.items(),
      };
    },
  };
}
