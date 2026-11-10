import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  BACKFILL_DAYS,
  claimDiscoveryRun,
  finishDiscovery,
  runDiscoverySources,
} from "../../discovery/run";
import { discoverySources } from "../../discovery/sources";
import { env } from "../../env";
import { getAppDb } from "../app-db";

// Scheduled job discovery: claim a run (one at a time), fetch and store every source, finish.
// Triage and assessment of the new jobs come in M14. See src/discovery/AGENTS.md.

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

const fetchSources = createStep({
  id: "fetch-sources",
  description: "Asks each source for new postings, screens them and stores jobs",
  inputSchema: z.object({ runId: z.string().nullable(), skipped: z.string().optional() }),
  outputSchema: z.object({
    runId: z.string().nullable(),
    skipped: z.string().optional(),
    sources: z.array(sourceResultSchema),
  }),
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

const finish = createStep({
  id: "finish-run",
  description: "Marks the run completed (or failed when every source failed)",
  inputSchema: fetchSources.outputSchema,
  outputSchema: z.object({
    runId: z.string().nullable(),
    status: z.enum(["completed", "failed", "skipped"]),
    skipped: z.string().optional(),
    sources: z.array(sourceResultSchema),
  }),
  execute: async ({ inputData }) => {
    if (!inputData.runId) return { ...inputData, status: "skipped" as const };
    const db = await getAppDb();
    const results = inputData.sources as Parameters<typeof finishDiscovery>[2];
    const { status } = await finishDiscovery(db, inputData.runId, results);
    return { ...inputData, status };
  },
});

export const discoverJobsWorkflow = createWorkflow({
  id: DISCOVER_JOBS_WORKFLOW_ID,
  description: "Fetches new job postings from the discovery sources, screens and stores them",
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
  .then(finish)
  .commit();
