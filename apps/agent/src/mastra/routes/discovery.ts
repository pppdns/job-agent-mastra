import { randomUUID } from "node:crypto";
import {
  AssessmentError,
  currentProfile,
  endRun,
  finishDiscoveryRun,
  getJobDetail,
  listDiscoveryRuns,
  startRun,
} from "@copilot/db";
import { ASSESS_BATCH_SIZES, RETRIAGE_MAX_JOBS } from "@copilot/shared";
import { registerApiRoute } from "@mastra/core/server";
import { z } from "zod";
import { closeUsage, discoveryThreadId } from "../../discovery/funnel";
import { BACKFILL_DAYS } from "../../discovery/run";
import { assessJob } from "../../rescore/run";
import { reportError } from "../../sentry";
import { RunRecorder } from "../../usage/recorder";
import { getAppDb } from "../app-db";
import { DISCOVER_JOBS_WORKFLOW_ID } from "../workflows/discover-jobs";

const MODE_TRIGGER = { fetch: "manual", triage: "triage", assess: "assess" } as const;
const MODE_LABEL = { fetch: "manual", triage: "triage only", assess: "assess only" } as const;

const bodySchema = z.object({
  /** fetch: the normal run; triage: triage the next batch of waiting jobs; assess: assess more matches. */
  mode: z.enum(["fetch", "triage", "assess"]).default("fetch"),
  lookbackDays: z
    .number()
    .int()
    .refine((d) => (BACKFILL_DAYS as readonly number[]).includes(d))
    .nullish(),
  /** assess only: how many matches to assess (default: the `maxAssessmentsPerRun` setting). */
  assessLimit: z
    .number()
    .int()
    .refine((n) => (ASSESS_BATCH_SIZES as readonly number[]).includes(n))
    .nullish(),
  /**
   * triage only: how many waiting jobs to triage ("Re-triage now" sends every waiting job;
   * default: the `maxTriagePerRun` setting). The run's spend cap grows to fit.
   */
  triageLimit: z.number().int().positive().max(RETRIAGE_MAX_JOBS).nullish(),
});

/**
 * POST /discovery/run — "Run now" (optionally a backfill of 7 or 30 days), "Triage next batch"
 * (mode triage) or "Assess more matches" (mode assess: no fetch, no triage). Starts the
 * discover-jobs workflow in the background; 409 while a run is going (the workflow's first step
 * also refuses a second run, so a race can't start two).
 */
export const discoveryRunRoute = registerApiRoute("/discovery/run", {
  method: "POST",
  handler: async (c) => {
    const parsed = bodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json(
        {
          error: `mode must be fetch, triage or assess; lookbackDays 7 or 30; assessLimit ${ASSESS_BATCH_SIZES.join(", ")}; triageLimit 1–${RETRIAGE_MAX_JOBS}`,
        },
        400,
      );
    }
    const { mode } = parsed.data;
    const lookbackDays = mode === "fetch" ? (parsed.data.lookbackDays ?? null) : null;
    const assessLimit = mode === "assess" ? (parsed.data.assessLimit ?? null) : null;
    const triageLimit = mode === "triage" ? (parsed.data.triageLimit ?? null) : null;
    const db = await getAppDb();
    const [latest] = await listDiscoveryRuns(db, 1);
    if (latest?.status === "running") return c.json({ error: "A discovery run is running" }, 409);
    const workflow = c.get("mastra").getWorkflow("discoverJobsWorkflow");
    const run = await workflow.createRun();
    const { runId } = await run.startAsync({
      inputData: { trigger: MODE_TRIGGER[mode], lookbackDays, assessLimit, triageLimit },
      tracingOptions: {
        rootSpanName: `discover-jobs (${MODE_LABEL[mode]}${lookbackDays ? `, ${lookbackDays}-day backfill` : ""}${assessLimit ? `, up to ${assessLimit}` : ""}${triageLimit ? `, up to ${triageLimit}` : ""})`,
      },
    });
    return c.json({ workflowRunId: runId, workflowId: DISCOVER_JOBS_WORKFLOW_ID }, 202);
  },
});

/**
 * POST /discovery/stop — "Stop run": cancels the running workflow (its steps get the abort
 * signal; an Apify run in flight is aborted) and ends the run as interrupted. What finished is
 * kept, and the next run catches up, as after a restart.
 */
export const discoveryStopRoute = registerApiRoute("/discovery/stop", {
  method: "POST",
  handler: async (c) => {
    const db = await getAppDb();
    const [latest] = await listDiscoveryRuns(db, 1);
    if (latest?.status !== "running") return c.json({ error: "No discovery run is running" }, 409);
    if (latest.workflowRunId) {
      try {
        const workflow = c.get("mastra").getWorkflow("discoverJobsWorkflow");
        const run = await workflow.createRun({ runId: latest.workflowRunId });
        await run.cancel();
      } catch (error) {
        // Still running: keep the row running, so the one-run lock keeps holding.
        console.error("discovery stop failed", error);
        reportError(error, { area: "discovery" });
        return c.json({ error: "The run could not be stopped; try again." }, 502);
      }
    }
    await finishDiscoveryRun(db, latest.id, "interrupted", "Stopped from /discovery");
    await closeUsage(db, latest.id, false);
    console.log(`discovery ${latest.id}: stopped from /discovery`);
    return c.json({ runId: latest.id });
  },
});

/**
 * POST /jobs/:jobId/assess — "Assess fully" on one job (typically a discovered one that only
 * has a triage score): the same structured assessment as re-score, saved as its next draft.
 * Usage is recorded like discovery runs, under a `discovery:assess-<id>` thread.
 */
export const assessJobRoute = registerApiRoute("/jobs/:jobId/assess", {
  method: "POST",
  handler: async (c) => {
    const jobId = c.req.param("jobId");
    const db = await getAppDb();
    if (!(await getJobDetail(db, jobId))) return c.json({ error: "Job not found" }, 404);
    const runId = randomUUID();
    const threadId = discoveryThreadId(`assess-${runId}`);
    await startRun(db, { id: runId, threadId });
    const recorder = new RunRecorder(db, threadId);
    recorder.attach(runId);
    try {
      const result = await assessJob(jobId, await currentProfile(db), { db, recorder });
      await recorder.flush();
      await endRun(db, runId, "completed");
      return c.json({ version: result.version });
    } catch (error) {
      await recorder.flush();
      await endRun(db, runId, "failed", error instanceof Error ? error.message : "failed");
      if (error instanceof AssessmentError) return c.json({ error: error.message }, 422);
      console.error("assessment failed", jobId, error);
      reportError(error, { area: "assess" });
      return c.json({ error: "The assessment failed; try again." }, 502);
    }
  },
});
