import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  assessStep,
  closeUsage,
  EMPTY_FUNNEL,
  reportStep,
  triageStep,
} from "../../discovery/funnel";
import {
  BACKFILL_DAYS,
  claimDiscoveryRun,
  finishDiscovery,
  runDiscoverySources,
} from "../../discovery/run";
import { discoverySources } from "../../discovery/sources";
import { env } from "../../env";
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
 * The schedule fires only in the main checkout's dev server on its own database: worktrees copy
 * `.env` and the database, so without this every checkout (and e2e, evals) would run it too.
 */
export function discoveryScheduleEnabled(source: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.DISCOVERY_SCHEDULE === "on" &&
    Number(source.AGENT_PORT ?? MAIN_AGENT_PORT) === MAIN_AGENT_PORT &&
    !source.DATABASE_URL
  );
}

const triggerSchema = z.object({
  trigger: z.enum(["schedule", "manual"]).default("schedule"),
  lookbackDays: z
    .number()
    .int()
    .refine((d) => (BACKFILL_DAYS as readonly number[]).includes(d))
    .nullish(),
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
  execute: async ({ inputData }) => {
    if (!inputData.runId) return { ...inputData, sources: [] };
    const db = await getAppDb();
    try {
      const sources = await runDiscoverySources(db, inputData.runId, discoverySources());
      return { ...inputData, sources };
    } catch (error) {
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
  execute: async ({ inputData, tracingContext, abortSignal }) => {
    if (!inputData.runId) return { ...inputData, funnel: EMPTY_FUNNEL };
    const db = await getAppDb();
    const funnel = await triageStep(db, inputData.runId, { tracingContext, signal: abortSignal });
    return { ...inputData, funnel };
  },
});

const assess = createStep({
  id: "assess-top-matches",
  description: "Fully assesses the run's best new matches (main model, budgeted)",
  inputSchema: funnelled,
  outputSchema: funnelled,
  execute: async ({ inputData, tracingContext, abortSignal }) => {
    if (!inputData.runId) return inputData;
    const db = await getAppDb();
    const funnel = await assessStep(db, inputData.runId, inputData.funnel, {
      tracingContext,
      signal: abortSignal,
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
