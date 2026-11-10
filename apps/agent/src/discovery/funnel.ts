import {
  type Db,
  DISCOVERY_THREAD_PREFIX,
  digestMatches,
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
import { env } from "../env";
import { RunRecorder } from "../usage/recorder";
import { assessTopMatches } from "./assess";
import { DiscoveryBudget } from "./budget";
import { runProblems, sendDigest } from "./report";
import { httpJson } from "./sources/http";
import { triageJobs } from "./triage";

// After fetching: triage → assess the best → digest. Each step records the run's funnel as it
// finishes, so a crash keeps what was done. Model usage goes to `app_runs`/`app_run_events`
// under the synthetic thread `discovery:<runId>` (the run id doubles as the usage run id), so
// the funnel's model cost is a sum of real usage events.

export const discoveryThreadId = (runId: string) => `${DISCOVERY_THREAD_PREFIX}${runId}`;

type StepContext = { tracingContext?: TracingContext; signal?: AbortSignal };

/** One recorder and budget per run, shared by its steps (they run in this process, in order). */
const runState = new Map<string, { recorder: RunRecorder; budget: DiscoveryBudget }>();

async function stateOf(db: Db, runId: string) {
  const existing = runState.get(runId);
  if (existing) return existing;
  const settings = await getSearchSettings(db);
  // The usage run row; it may exist already when a step is retried.
  await startRun(db, { id: runId, threadId: discoveryThreadId(runId) }).catch(() => undefined);
  const recorder = new RunRecorder(db, discoveryThreadId(runId));
  recorder.attach(runId);
  const state = {
    recorder,
    budget: new DiscoveryBudget({
      maxUsd: settings.maxLlmUsdPerRun,
      maxTriage: settings.maxTriagePerRun,
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

async function triage(db: Db, runId: string, context: StepContext) {
  const { recorder, budget } = await stateOf(db, runId);
  const outcome = await triageJobs({ db, budget, recorder, ...context });
  const funnel: FunnelResult = {
    ...EMPTY_FUNNEL,
    triaged: outcome.triaged,
    triageFailed: outcome.failed,
    triagePending: outcome.pending,
    matched: outcome.matched,
    llmUsd: await llmUsd(db, runId, recorder),
    ...(budget.stoppedBy ? { stoppedBy: budget.stoppedBy } : {}),
  };
  await recordFunnel(db, runId, funnel);
  return funnel;
}

async function assess(db: Db, runId: string, funnel: FunnelResult, context: StepContext) {
  const { recorder, budget } = await stateOf(db, runId);
  const run = await getDiscoveryRun(db, runId);
  const outcome = await assessTopMatches({
    db,
    since: run?.startedAt ?? new Date(),
    budget,
    threadId: discoveryThreadId(runId),
    recorder,
    ...context,
  });
  const next: FunnelResult = {
    ...funnel,
    assessed: outcome.assessed,
    assessFailed: outcome.failed,
    llmUsd: await llmUsd(db, runId, recorder),
    ...(budget.stoppedBy ? { stoppedBy: budget.stoppedBy } : {}),
  };
  await recordFunnel(db, runId, next);
  return next;
}

async function report(db: Db, runId: string, funnel: FunnelResult) {
  const [run, settings, recent] = await Promise.all([
    getDiscoveryRun(db, runId),
    getSearchSettings(db),
    listDiscoveryRuns(db, 20),
  ]);
  const problems = run ? runProblems(run, funnel, sourceStates(recent, DISCOVERY_SOURCES)) : [];
  const matches = await digestMatches(db, {
    since: run?.startedAt ?? new Date(),
    threshold: settings.triageThreshold,
  });
  const digest = await sendDigest(
    httpJson,
    {
      apiKey: env.RESEND_API_KEY,
      to: env.DIGEST_TO,
      from: env.DIGEST_FROM,
      baseUrl: env.APP_BASE_URL,
    },
    matches,
    problems,
    recent.filter((r) => r.id !== runId),
  );
  const next: FunnelResult = { ...funnel, digest };
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
