import { countAwaitingTriage } from "@copilot/db";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  assessStep,
  closeUsage,
  EMPTY_FUNNEL,
  reportStep,
  triageStep,
} from "../../discovery/funnel";
import { createProgress } from "../../discovery/progress";
import {
  BACKFILL_DAYS,
  claimDiscoveryRun,
  fetchesSources,
  finishDiscovery,
  runDiscoverySources,
} from "../../discovery/run";
import { discoverySources } from "../../discovery/sources";
import { env } from "../../env";
import { reportError } from "../../sentry";
import { getAppDb } from "../app-db";

// Scheduled job discovery: claim a run (one at a time), fetch and store every source, triage the
// new jobs, assess the best, email a digest, finish. See src/discovery/AGENTS.md.

export const DISCOVER_JOBS_WORKFLOW_ID = "discover-jobs";
/** Mastra's id for a workflow's single declarative schedule. */
export const DISCOVER_JOBS_SCHEDULE_ID = `wf_${DISCOVER_JOBS_WORKFLOW_ID}`;
export const DISCOVERY_CRON = "0 7,16 * * *";

/** Default agent port = the main checkout (scripts/ports.sh slot 0). */
const MAIN_AGENT_PORT = 4111;

/**
 * Where the schedule may fire (with DISCOVERY_SCHEDULE=on): the production image (`NODE_ENV`
 * production: the Fly machine, its own database), or the main checkout's dev server on its own
 * database. Worktrees copy `.env` and the database, so without the dev rule every checkout (and
 * e2e, evals) would run it too. Never turn it on both locally and on Fly: two schedules mean two
 * runs, bills and emails, against different databases.
 */
export function discoveryScheduleEnabled(
  source: NodeJS.ProcessEnv = process.env,
  schedule: "on" | "off" = env.DISCOVERY_SCHEDULE,
): boolean {
  if (schedule !== "on") return false;
  if (source.NODE_ENV === "production") return true;
  return Number(source.AGENT_PORT ?? MAIN_AGENT_PORT) === MAIN_AGENT_PORT && !source.DATABASE_URL;
}

const triggerSchema = z.object({
  trigger: z.enum(["schedule", "manual", "triage", "assess"]).default("schedule"),
  lookbackDays: z
    .number()
    .int()
    .refine((d) => (BACKFILL_DAYS as readonly number[]).includes(d))
    .nullish(),
  /** Assess-only runs: how many matches to assess (unset: the `maxAssessmentsPerRun` setting). */
  assessLimit: z.number().int().positive().nullish(),
});

const sourceResultSchema = z.object({
  source: z.string(),
  status: z.string(),
  message: z.string().optional(),
  fetched: z.number(),
  newJobs: z.number(),
  merged: z.number(),
  filtered: z.number(),
  costUsd: z.number(),
});

const claim = createStep({
  id: "claim-run",
  description: "Starts a discovery run unless one is already running",
  inputSchema: triggerSchema,
  outputSchema: z.object({ runId: z.string().nullable(), skipped: z.string().optional() }),
  execute: async ({ inputData, runId }) => {
    const db = await getAppDb();
    return claimDiscoveryRun(db, inputData, runId);
  },
});

const fetchedSchema = z.object({
  runId: z.string().nullable(),
  skipped: z.string().optional(),
  sources: z.array(sourceResultSchema),
});

const fetchSources = createStep({
  id: "fetch-sources",
  description: "Asks each source for new postings, screens them and stores jobs",
  inputSchema: z.object({ runId: z.string().nullable(), skipped: z.string().optional() }),
  outputSchema: fetchedSchema,
  execute: async ({ inputData, getInitData, abortSignal }) => {
    if (!inputData.runId) return { ...inputData, sources: [] };
    const { trigger } = triggerSchema.parse(getInitData());
    if (!fetchesSources(trigger)) return { ...inputData, sources: [] };
    const db = await getAppDb();
    try {
      const progress = createProgress(db, inputData.runId);
      progress.step("fetch");
      const sources = await runDiscoverySources(db, inputData.runId, discoverySources(), {
        progress,
        signal: abortSignal,
      });
      return { ...inputData, sources };
    } catch (error) {
      // Stopped: the stop route ends the run as interrupted; finishing here would race it.
      if (abortSignal?.aborted) throw error;
      reportError(error, { area: "discovery" });
      await finishDiscovery(db, inputData.runId, []).catch(() => undefined);
      throw error;
    }
  },
});

const funnelSchema = z.object({
  triaged: z.number(),
  triageFailed: z.number(),
  triagePending: z.number(),
  matched: z.number(),
  assessed: z.number(),
  assessFailed: z.number(),
  triageErrors: z.array(z.string()).optional(),
  assessErrors: z.array(z.string()).optional(),
  llmUsd: z.number(),
  stoppedBy: z.string().optional(),
  digest: z
    .object({
      status: z.enum(["sent", "skipped", "failed"]),
      message: z.string(),
      matches: z.number(),
    })
    .optional(),
});

const fetched = fetchedSchema;
const funnelled = fetchedSchema.extend({ funnel: funnelSchema });

const triage = createStep({
  id: "triage",
  description: "Scores new discovered jobs against the profile with the fast model (budgeted)",
  inputSchema: fetched,
  outputSchema: funnelled,
  execute: async ({ inputData, getInitData, tracingContext, abortSignal }) => {
    if (!inputData.runId) return { ...inputData, funnel: EMPTY_FUNNEL };
    const db = await getAppDb();
    if (triggerSchema.parse(getInitData()).trigger === "assess") {
      return {
        ...inputData,
        funnel: { ...EMPTY_FUNNEL, triagePending: await countAwaitingTriage(db) },
      };
    }
    const funnel = await triageStep(db, inputData.runId, { tracingContext, signal: abortSignal });
    return { ...inputData, funnel };
  },
});

const assess = createStep({
  id: "assess-top-matches",
  description: "Fully assesses the run's best new matches (main model, budgeted)",
  inputSchema: funnelled,
  outputSchema: funnelled,
  execute: async ({ inputData, getInitData, tracingContext, abortSignal }) => {
    if (!inputData.runId) return inputData;
    const db = await getAppDb();
    const { assessLimit } = triggerSchema.parse(getInitData());
    const funnel = await assessStep(db, inputData.runId, inputData.funnel, {
      tracingContext,
      signal: abortSignal,
      assessLimit: assessLimit ?? undefined,
    });
    return { ...inputData, funnel };
  },
});

const report = createStep({
  id: "report",
  description: "Emails the run's new matches (when configured and there are any)",
  inputSchema: funnelled,
  outputSchema: funnelled,
  execute: async ({ inputData }) => {
    if (!inputData.runId) return inputData;
    const db = await getAppDb();
    return { ...inputData, funnel: await reportStep(db, inputData.runId, inputData.funnel) };
  },
});

const finish = createStep({
  id: "finish-run",
  description: "Marks the run completed (or failed when every source failed)",
  inputSchema: funnelled,
  outputSchema: funnelled.extend({ status: z.enum(["completed", "failed", "skipped"]) }),
  execute: async ({ inputData }) => {
    if (!inputData.runId) return { ...inputData, status: "skipped" as const };
    const db = await getAppDb();
    const results = inputData.sources as Parameters<typeof finishDiscovery>[2];
    const { status } = await finishDiscovery(db, inputData.runId, results);
    await closeUsage(db, inputData.runId, status === "failed");
    return { ...inputData, status };
  },
});

export const discoverJobsWorkflow = createWorkflow({
  id: DISCOVER_JOBS_WORKFLOW_ID,
  description:
    "Fetches new job postings, screens and stores them, triages them, assesses the best and emails a digest",
  inputSchema: triggerSchema,
  outputSchema: finish.outputSchema,
  // Mastra's server restarts active runs at boot, but startup already marks them interrupted
  // (interruptStaleDiscoveryRuns): a restarted run would then run unseen, never finish, and
  // let a second run start beside it. The next run catches up instead.
  options: { autoRestartActiveRuns: false },
  ...(discoveryScheduleEnabled()
    ? {
        schedule: {
          cron: DISCOVERY_CRON,
          timezone: env.DISCOVERY_TZ,
          inputData: { trigger: "schedule" as const },
        },
      }
    : {}),
})
  .then(claim)
  .then(fetchSources)
  .then(triage)
  .then(assess)
  .then(report)
  .then(finish)
  .commit();
