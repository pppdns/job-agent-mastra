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
  signal?: AbortSignal;
};

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
};

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
