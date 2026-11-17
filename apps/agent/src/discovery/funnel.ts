import {
  type Db,
  DISCOVERY_THREAD_PREFIX,
  digestMatches,
  discoveryRunsSince,
  endRun,
  type FunnelResult,
  getDiscoveryRun,
  getSearchSettings,
  listDiscoveryRuns,
  recordFunnel,
  sourceStates,
  startRun,
  threadUsage,
} from "@copilot/db";
import { DISCOVERY_SOURCES } from "@copilot/shared";
import type { TracingContext } from "@mastra/core/observability";
import { emailConfig } from "../email";
import { RunRecorder } from "../usage/recorder";
import { assessTopMatches } from "./assess";
import {
  ASSESS_RESERVE_USD,
  assessmentShare,
  DiscoveryBudget,
  EXTRACT_RESERVE_USD,
  TRIAGE_RESERVE_USD,
} from "./budget";
import { extractJobs } from "./extract";
import { createProgress } from "./progress";
import { ALERT_REPEAT_MS, runProblems, sendDigest } from "./report";
import { httpJson } from "./sources/http";
import { triageJobs } from "./triage";

// After fetching: triage → assess the best → digest. Each step records the run's funnel as it
// finishes, so a crash keeps what was done. Model usage goes to `app_runs`/`app_run_events`
// under the synthetic thread `discovery:<runId>` (the run id doubles as the usage run id), so
// the funnel's model cost is a sum of real usage events.

export const discoveryThreadId = (runId: string) => `${DISCOVERY_THREAD_PREFIX}${runId}`;

type StepContext = {
  tracingContext?: TracingContext;
  signal?: AbortSignal;
  /** Assess-only runs: the batch size picked on /discovery (overrides `maxAssessmentsPerRun`). */
  assessLimit?: number;
  /** Triage-only runs: how many waiting jobs to triage (overrides `maxTriagePerRun`). */
  triageLimit?: number;
  /** Facts-only runs (the backfill): how many jobs to extract facts for; nothing else runs. */
  extractLimit?: number;
};

/** One recorder and budget per run, shared by its steps (they run in this process, in order). */
const runState = new Map<string, { recorder: RunRecorder; budget: DiscoveryBudget }>();

/**
 * `assessLimit` and `triageLimit` are batches the user picked; the run's spend cap then grows to
 * cover their reservations (triage's plus the assessments' share), so the batch isn't cut short
 * by the cap meant for scheduled runs.
 */
async function stateOf(
  db: Db,
  runId: string,
  limits: { assessLimit?: number; triageLimit?: number; extractLimit?: number } = {},
) {
  const existing = runState.get(runId);
  if (existing) return existing;
  const settings = await getSearchSettings(db);
  const keepForAssessUsd = assessmentShare(settings.maxLlmUsdPerRun, settings.maxAssessmentsPerRun);
  const maxUsd = Math.max(
    settings.maxLlmUsdPerRun,
    (limits.assessLimit ?? 0) * ASSESS_RESERVE_USD,
    // A triage batch reads each job's facts first.
    limits.triageLimit
      ? limits.triageLimit * (TRIAGE_RESERVE_USD + EXTRACT_RESERVE_USD) + keepForAssessUsd
      : 0,
    limits.extractLimit ? limits.extractLimit * EXTRACT_RESERVE_USD + keepForAssessUsd : 0,
  );
  // The usage run row; it may exist already when a step is retried.
  await startRun(db, { id: runId, threadId: discoveryThreadId(runId) }).catch(() => undefined);
  const recorder = new RunRecorder(db, discoveryThreadId(runId));
  recorder.attach(runId);
  const state = {
    recorder,
    budget: new DiscoveryBudget({
      maxUsd,
      maxTriage: limits.triageLimit ?? settings.maxTriagePerRun,
      // A re-triage batch reads facts for every job it triages, not just the per-run cap.
      maxExtract: limits.extractLimit ?? limits.triageLimit ?? settings.maxTriagePerRun,
      keepForAssessUsd,
    }),
  };
  runState.set(runId, state);
  return state;
}

/** The run's model cost so far, from its usage events. */
async function llmUsd(db: Db, runId: string, recorder: RunRecorder) {
  await recorder.flush();
  return (await threadUsage(db, discoveryThreadId(runId))).totals.estimatedLlmUsd;
}

export const EMPTY_FUNNEL: FunnelResult = {
  triaged: 0,
  triageFailed: 0,
  triagePending: 0,
  matched: 0,
  assessed: 0,
  assessFailed: 0,
  llmUsd: 0,
};

/**
 * Runs one funnel step; an unexpected error is recorded on the funnel instead of failing the
 * workflow, so the run still finishes (and later steps still run on what exists).
 */
async function guarded(
  db: Db,
  runId: string,
  funnel: FunnelResult,
  step: string,
  run: () => Promise<FunnelResult>,
): Promise<FunnelResult> {
  try {
    return await run();
  } catch (error) {
    console.error(`discovery ${step} failed`, error);
    const message = error instanceof Error ? error.message : "failed";
    const next = { ...funnel, stoppedBy: `${step} failed: ${message}`.slice(0, 300) };
    await recordFunnel(db, runId, next).catch(() => undefined);
    return next;
  }
}

export function triageStep(db: Db, runId: string, context: StepContext = {}) {
  return guarded(db, runId, EMPTY_FUNNEL, "triage", () => triage(db, runId, context));
}

export function assessStep(db: Db, runId: string, funnel: FunnelResult, context: StepContext = {}) {
  return guarded(db, runId, funnel, "assessment", () => assess(db, runId, funnel, context));
}

export function reportStep(db: Db, runId: string, funnel: FunnelResult) {
  return guarded(db, runId, funnel, "report", () => report(db, runId, funnel));
}

/**
 * Listing facts first (they decide which jobs are hidden, so triage skips those), then triage.
 * A facts-only run (`extractLimit`) stops after the facts.
 */
async function triage(
  db: Db,
  runId: string,
  { triageLimit, extractLimit, ...context }: StepContext,
) {
  const { recorder, budget } = await stateOf(db, runId, { triageLimit, extractLimit });
  const progress = createProgress(db, runId);
  progress.step("extract");
  const facts = await extractJobs({
    db,
    budget,
    recorder,
    ...context,
    limit: extractLimit ?? budget.limits.maxExtract ?? budget.limits.maxTriage,
    // Scheduled and triage runs read facts for what they triage; the backfill reads the rest.
    untriagedOnly: extractLimit === undefined,
    onProgress: (done, total) => progress.work(done, total),
  });
  await progress.flush();
  const factsFunnel = {
    extracted: facts.extracted,
    extractFailed: facts.failed,
    extractPending: facts.pending,
    ...(facts.errors.length > 0 ? { extractErrors: facts.errors } : {}),
  };
  if (extractLimit !== undefined) {
    const funnel: FunnelResult = {
      ...EMPTY_FUNNEL,
      ...factsFunnel,
      llmUsd: await llmUsd(db, runId, recorder),
      ...(budget.stoppedBy ? { stoppedBy: budget.stoppedBy } : {}),
    };
    await recordFunnel(db, runId, funnel);
    return funnel;
  }
  progress.step("triage");
  const outcome = await triageJobs({
    db,
    budget,
    recorder,
    ...context,
    limit: triageLimit,
    onProgress: (done, total) => progress.work(done, total),
  });
  await progress.flush();
  const funnel: FunnelResult = {
    ...EMPTY_FUNNEL,
    ...factsFunnel,
    triaged: outcome.triaged,
    triageFailed: outcome.failed,
    triagePending: outcome.pending,
    matched: outcome.matched,
    ...(outcome.errors.length > 0 ? { triageErrors: outcome.errors } : {}),
    llmUsd: await llmUsd(db, runId, recorder),
    ...(budget.stoppedBy ? { stoppedBy: budget.stoppedBy } : {}),
  };
  await recordFunnel(db, runId, funnel);
  return funnel;
}

async function assess(
  db: Db,
  runId: string,
  funnel: FunnelResult,
  { assessLimit, ...context }: StepContext,
) {
  const { recorder, budget } = await stateOf(db, runId, { assessLimit });
  const run = await getDiscoveryRun(db, runId);
  const progress = createProgress(db, runId);
  progress.step("assess");
  const outcome = await assessTopMatches({
    db,
    // An assess-only run picks from every open match; the others assess their own new matches.
    since: run?.trigger === "assess" ? undefined : (run?.startedAt ?? new Date()),
    limit: assessLimit,
    budget,
    threadId: discoveryThreadId(runId),
    recorder,
    ...context,
    onProgress: (done, total) => progress.work(done, total),
  });
  await progress.flush();
  const next: FunnelResult = {
    ...funnel,
    assessed: outcome.assessed,
    assessFailed: outcome.failed,
    ...(outcome.errors.length > 0 ? { assessErrors: outcome.errors } : {}),
    llmUsd: await llmUsd(db, runId, recorder),
    ...(budget.stoppedBy ? { stoppedBy: budget.stoppedBy } : {}),
  };
  await recordFunnel(db, runId, next);
  return next;
}

/** Most matches under the digest threshold counted for the "no email" reason. */
const BELOW_DIGEST_COUNT_LIMIT = 500;

async function report(db: Db, runId: string, funnel: FunnelResult) {
  const progress = createProgress(db, runId);
  progress.step("report");
  const [run, settings, recent, lastDay] = await Promise.all([
    getDiscoveryRun(db, runId),
    getSearchSettings(db),
    listDiscoveryRuns(db, 20),
    // The whole throttle window, however many runs it holds.
    discoveryRunsSince(db, new Date(Date.now() - ALERT_REPEAT_MS)),
  ]);
  const problems = run ? runProblems(run, funnel, sourceStates(recent, DISCOVERY_SOURCES)) : [];
  const threshold = Math.max(settings.digestThreshold, settings.triageThreshold);
  const since = run?.startedAt ?? new Date();
  // Only strong matches are emailed; never one the job list hides.
  const matches = await digestMatches(db, { since, threshold });
  // Without a digest: the run's matches the job list shows that scored under the digest
  // threshold (the same filters, from the triage threshold up), so "no email" can say why.
  const below =
    matches.length === 0 && threshold > settings.triageThreshold
      ? (
          await digestMatches(db, {
            since,
            threshold: settings.triageThreshold,
            limit: BELOW_DIGEST_COUNT_LIMIT,
          })
        ).length
      : 0;
  const digest = await sendDigest(
    httpJson,
    emailConfig(),
    matches,
    problems,
    lastDay.filter((r) => r.id !== runId),
    { count: below, threshold },
  );
  const next: FunnelResult = { ...funnel, digest };
  await progress.flush();
  await recordFunnel(db, runId, next);
  return next;
}

/** Closes the run's usage record and forgets its in-memory state. */
export async function closeUsage(db: Db, runId: string, failed: boolean) {
  const state = runState.get(runId);
  await state?.recorder.flush();
  runState.delete(runId);
  if (state) await endRun(db, runId, failed ? "failed" : "completed");
}
