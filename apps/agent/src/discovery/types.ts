import type { DiscoverySource, PostingInput, SearchSettings } from "@copilot/shared";

export type FetchContext = {
  settings: SearchSettings;
  /** Ask for postings published since this date. */
  since: Date;
  /** Set for a manual backfill: the source may read deeper and spend more. */
  backfill: boolean;
  /** Board ids already stored (paid sources skip them). */
  knownIds: string[];
  /** Most this source may spend in this run (USD). */
  maxUsd: number;
  /** Wall-clock end of this source's time in the run: no new request or search starts after it. */
  deadline?: Date;
  signal?: AbortSignal;
  /** Called before each search or request (`done` of `total` finished), for live progress. */
  onProgress?: (done: number, total: number, label?: string) => void;
};

/** Milliseconds left before the source's deadline (Infinity without one). */
export const timeLeftMs = (context: Pick<FetchContext, "deadline">, now = Date.now()) =>
  context.deadline ? context.deadline.getTime() - now : Number.POSITIVE_INFINITY;

/** The failure a source reports when its deadline stopped it before every search ran. */
export const timeLimitFailure = (skipped: number, total: number) =>
  `time limit reached, ${skipped} of ${total} searches not run`;

export type FetchOutcome = {
  postings: PostingInput[];
  /** Items that failed validation (counted, then dropped). */
  invalid: number;
  /** Provider cost (USD, estimated from the source's own prices). */
  costUsd: number;
  /** Set when only part of the work was done (failed searches, or a cap stopped it). */
  partial?: string;
  /** Searches that failed (provider or network errors, rate limits); empty when only a cap stopped it. */
  failures?: string[];
  /** Raw provider items kept for later parser checks (`RawSampler`). */
  raw?: RawItems;
  /** The Apify runs behind this outcome (their datasets stay in Apify for its retention time). */
  providerRuns?: ProviderRun[];
};

export type RawItems = { invalid: unknown[]; sample: unknown[] };
export type ProviderRun = { label: string; runId: string; datasetId: string };

/** Raw items a run keeps per source: every item that failed parsing (up to a cap) and a few valid ones. */
export const RAW_INVALID_CAP = 25;
export const RAW_SAMPLE_CAP = 5;

/** Collects raw items as a source parses them; `items()` is what goes into the outcome. */
export function rawSampler() {
  const kept: RawItems = { invalid: [], sample: [] };
  return {
    invalid(raw: unknown) {
      if (kept.invalid.length < RAW_INVALID_CAP) kept.invalid.push(raw);
    },
    valid(raw: unknown) {
      if (kept.sample.length < RAW_SAMPLE_CAP) kept.sample.push(raw);
    },
    items: (): RawItems => kept,
  };
}

/** A job board adapter: a pure mapping plus a thin fetch. */
export interface JobSource {
  id: DiscoverySource;
  /** Paid through Apify: counts against the monthly budget and needs APIFY_API_KEY. */
  paid: boolean;
  /** Null when usable; otherwise why not (e.g. a missing key). */
  unavailable(): string | null;
  fetch(context: FetchContext): Promise<FetchOutcome>;
}

/** A source failure with a short, secret-free message for the run page. */
export class SourceError extends Error {}

/** The provider asked us to wait longer than we retry for: stop asking it for this run. */
export class CooldownError extends SourceError {}
