import { randomUUID } from "node:crypto";
import {
  AssessmentError,
  currentProfile,
  endRun,
  getJobDetail,
  listDiscoveryRuns,
  startRun,
} from "@copilot/db";
import { registerApiRoute } from "@mastra/core/server";
import { z } from "zod";
import { discoveryThreadId } from "../../discovery/funnel";
import { BACKFILL_DAYS } from "../../discovery/run";
import { assessJob } from "../../rescore/run";
import { reportError } from "../../sentry";
import { RunRecorder } from "../../usage/recorder";
import { getAppDb } from "../app-db";
import { DISCOVER_JOBS_WORKFLOW_ID } from "../workflows/discover-jobs";

const bodySchema = z.object({
  lookbackDays: z
    .number()
    .int()
    .refine((d) => (BACKFILL_DAYS as readonly number[]).includes(d))
    .nullish(),
});

/**
 * POST /discovery/run — "Run now" (optionally a backfill of 7 or 30 days). Starts the
 * discover-jobs workflow in the background; 409 while a run is going (the workflow's first step
 * also refuses a second run, so a race can't start two).
 */
export const discoveryRunRoute = registerApiRoute("/discovery/run", {
  method: "POST",
  handler: async (c) => {
    const parsed = bodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "lookbackDays must be 7 or 30" }, 400);
    const db = await getAppDb();
    const [latest] = await listDiscoveryRuns(db, 1);
    if (latest?.status === "running") return c.json({ error: "A discovery run is running" }, 409);
    const workflow = c.get("mastra").getWorkflow("discoverJobsWorkflow");
    const run = await workflow.createRun();
    const { runId } = await run.startAsync({
      inputData: { trigger: "manual", lookbackDays: parsed.data.lookbackDays ?? null },
      tracingOptions: {
        rootSpanName: `discover-jobs (manual${parsed.data.lookbackDays ? `, ${parsed.data.lookbackDays}-day backfill` : ""})`,
      },
    });
    return c.json({ workflowRunId: runId, workflowId: DISCOVER_JOBS_WORKFLOW_ID }, 202);
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
