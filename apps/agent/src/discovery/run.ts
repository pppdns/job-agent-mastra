import {
  type Db,
  type DiscoveryTrigger,
  discoveryRunsSince,
  finishDiscoveryRun,
  getDiscoveryRun,
  getSearchSettings,
  knownExternalIds,
  listDiscoveryRuns,
  type PostingOutcome,
  pruneRawItems,
  recordPosting,
  recordRawItems,
  recordSourceResult,
  type SourceRunResult,
  sourceSpendSince,
  sourceStates,
  startDiscoveryRun,
} from "@copilot/db";
import {
  DISCOVERY_SOURCES,
  type DiscoverySource,
  type SearchSettings,
  screenPosting,
} from "@copilot/shared";
import { reportError } from "../sentry";
import { noProgress, type ProgressReporter } from "./progress";
import { BACKFILL_USD_FACTOR } from "./sources/linkedin";
import type { JobSource } from "./types";

// One discovery run: claim the run (one at a time), ask each enabled source for what's new since
// its last good run (or a backfill window), screen and store every posting, record per-source
// results as they finish. A failing source never stops the others.

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** Paid sources stop for the rest of the month once the budget is spent (rolling 30 days). */
const BUDGET_WINDOW_MS = 30 * DAY_MS;
/** Re-ask from an hour before the last good run started, so nothing posted around it is missed. */
const CURSOR_OVERLAP_MS = HOUR_MS;
/**
 * Most time one source may take in a run. Sources run one after another, so a slow board
 * (HiringCafe: ~2 min per phrase, up to ~11 min when Apify stalls) can't hold up the others or
 * keep the run "running" for hours. Past it the source keeps what it has (partial).
 */
export const SOURCE_TIME_LIMIT_MS = 20 * 60_000;

export const BACKFILL_DAYS = [7, 30] as const;

export type DiscoveryTriggerInput = {
  trigger: DiscoveryTrigger;
  /** Manual backfill: look this many days back and allow the sources' raised caps. */
  lookbackDays?: number | null;
};

/** Triage-only and assess-only runs skip fetching. */
export const fetchesSources = (trigger: DiscoveryTrigger) =>
  trigger === "schedule" || trigger === "manual";

export type Claim = { runId: string } | { runId: null; skipped: string };

export async function claimDiscoveryRun(
  db: Db,
  input: DiscoveryTriggerInput,
  workflowRunId?: string,
): Promise<Claim> {
  const run = await startDiscoveryRun(db, {
    trigger: input.trigger,
    lookbackDays: input.lookbackDays ?? null,
    workflowRunId,
  });
  return run ? { runId: run.id } : { runId: null, skipped: "another discovery run is running" };
}

const enabled = (settings: SearchSettings, source: DiscoverySource) =>
  settings.sources[source].enabled;

/** Per-run spend cap of a paid source (raised for a backfill). */
const maxUsdOf = (source: DiscoverySource, settings: SearchSettings, backfill: boolean) => {
  const config = settings.sources[source];
  return "maxUsdPerRun" in config ? config.maxUsdPerRun * (backfill ? BACKFILL_USD_FACTOR : 1) : 0;
};

/** A source that re-reads the same window every run (no "since") runs at most this often. */
const minHoursOf = (source: DiscoverySource, settings: SearchSettings) => {
  const config = settings.sources[source];
  return "minHoursBetweenRuns" in config ? config.minHoursBetweenRuns : 0;
};

export async function runDiscoverySources(
  db: Db,
  runId: string,
  /** The sources to run (all of them in production; tests pass a few). */
  sources: Partial<Record<DiscoverySource, JobSource>>,
  options: { now?: () => Date; signal?: AbortSignal; progress?: ProgressReporter } = {},
): Promise<SourceRunResult[]> {
  const now = options.now ?? (() => new Date());
  const progress = options.progress ?? noProgress;
  const started = now();
  const [settings, run, recent] = await Promise.all([
    getSearchSettings(db),
    getDiscoveryRun(db, runId),
    listDiscoveryRuns(db, 20),
  ]);
  const lookbackDays = run?.lookbackDays ?? null;
  const backfill = lookbackDays !== null;
  const maxAgeDays = Math.max(settings.maxAgeDays, lookbackDays ?? 0);
  const states = sourceStates(
    recent.filter((r) => r.id !== runId),
    DISCOVERY_SOURCES,
  );
  const ids = DISCOVERY_SOURCES.filter((id) => sources[id]);
  const paidIds = ids.filter((id) => sources[id]?.paid);
  let paidSpent = await sourceSpendSince(
    db,
    paidIds,
    new Date(started.getTime() - BUDGET_WINDOW_MS),
  );

  await pruneRawItems(db, started).catch((e) => console.error("pruning raw items failed", e));

  const results: SourceRunResult[] = [];
  for (const id of ids) {
    const source = sources[id];
    if (!source) continue;
    const t0 = Date.now();
    const base = {
      source: id,
      fetched: 0,
      invalid: 0,
      seen: 0,
      filtered: 0,
      newJobs: 0,
      merged: 0,
      costUsd: 0,
      durationMs: 0,
    } satisfies Omit<SourceRunResult, "status">;
    const finish = async (result: SourceRunResult) => {
      const final = { ...result, durationMs: Date.now() - t0 };
      results.push(final);
      await recordSourceResult(db, runId, final);
      if (final.status !== "skipped") {
        console.info(
          `discovery ${runId}: ${id} ${final.status} in ${Math.round(final.durationMs / 1000)}s, ` +
            `${final.fetched} fetched, ${final.newJobs} new, $${final.costUsd.toFixed(2)}` +
            (final.message ? ` (${final.message})` : ""),
        );
      }
    };

    const unavailable = !enabled(settings, id)
      ? "turned off in search settings"
      : source.unavailable();
    if (unavailable) {
      await finish({ ...base, status: "skipped", message: unavailable });
      continue;
    }
    const lastOk = states.find((s) => s.source === id)?.lastOkAt;
    const minHours = minHoursOf(id, settings);
    // Read from every run in the interval, not the last 20 (skipped runs would push it out).
    const lastPull =
      minHours > 0 && !backfill
        ? sourceStates(
            (await discoveryRunsSince(db, new Date(started.getTime() - minHours * HOUR_MS))).filter(
              (r) => r.id !== runId,
            ),
            [id],
          )[0]?.lastOkAt
        : null;
    const hoursSince = lastPull ? (started.getTime() - lastPull.getTime()) / HOUR_MS : null;
    if (!backfill && minHours > 0 && hoursSince !== null && hoursSince < minHours) {
      await finish({
        ...base,
        status: "skipped",
        message: `last good run ${Math.floor(hoursSince)} h ago (runs at most every ${minHours} h)`,
      });
      continue;
    }
    const budget = settings.apifyMonthlyBudgetUsd;
    const maxUsd = source.paid ? Math.min(maxUsdOf(id, settings, backfill), budget - paidSpent) : 0;
    if (source.paid && maxUsd < 0.01) {
      await finish({
        ...base,
        status: "skipped",
        message: `monthly Apify budget reached (${paidSpent.toFixed(2)} of ${budget.toFixed(2)} USD in 30 days)`,
      });
      continue;
    }

    const floor = started.getTime() - maxAgeDays * DAY_MS;
    const since = new Date(
      backfill || !lastOk ? floor : Math.max(floor, lastOk.getTime() - CURSOR_OVERLAP_MS),
    );

    progress.source(id);
    try {
      const knownIds = await knownExternalIds(
        db,
        id,
        new Date(started.getTime() - BUDGET_WINDOW_MS),
      );
      const outcome = await source.fetch({
        settings,
        since,
        backfill,
        knownIds,
        maxUsd,
        deadline: new Date(Date.now() + SOURCE_TIME_LIMIT_MS),
        signal: options.signal,
        onProgress: (done, total, label) => progress.work(done, total, label),
      });
      const counts: Record<PostingOutcome, number> = {
        seen: 0,
        filtered: 0,
        new_job: 0,
        merged: 0,
      };
      for (const posting of outcome.postings) {
        const screen = screenPosting(settings, posting, now(), maxAgeDays);
        counts[await recordPosting(db, { posting, screen, runId, now: now() })] += 1;
      }
      paidSpent += outcome.costUsd;
      await finish({
        ...base,
        status: outcome.partial ? "partial" : "ok",
        message: outcome.partial?.slice(0, 500),
        ...(outcome.failures?.length ? { failures: outcome.failures.slice(0, 10) } : {}),
        fetched: outcome.postings.length,
        invalid: outcome.invalid,
        seen: counts.seen,
        filtered: counts.filtered,
        newJobs: counts.new_job,
        merged: counts.merged,
        costUsd: outcome.costUsd,
        since: since.toISOString(),
        ...(outcome.providerRuns?.length
          ? { providerRuns: outcome.providerRuns.slice(0, 20) }
          : {}),
      });
      if (outcome.raw) {
        // Diagnostics only: losing them never fails the source.
        await recordRawItems(db, { runId, source: id, ...outcome.raw, now: now() }).catch((e) =>
          console.error(`storing raw items of ${id} failed`, e),
        );
      }
    } catch (error) {
      if (options.signal?.aborted) throw error;
      console.error(`discovery source ${id} failed`, error);
      reportError(error, { area: "discovery", source: id });
      await finish({
        ...base,
        status: "failed",
        message: (error instanceof Error ? error.message : "failed").slice(0, 500),
        since: since.toISOString(),
      });
    }
  }
  await progress.flush();
  return results;
}

/** Ends the run: failed when every source that ran failed, otherwise completed. */
export async function finishDiscovery(db: Db, runId: string, results: SourceRunResult[]) {
  const ran = results.filter((r) => r.status !== "skipped");
  const failed = ran.length > 0 && ran.every((r) => r.status === "failed");
  await finishDiscoveryRun(
    db,
    runId,
    failed ? "failed" : "completed",
    failed ? "every source failed" : undefined,
  );
  return { status: failed ? ("failed" as const) : ("completed" as const) };
}
