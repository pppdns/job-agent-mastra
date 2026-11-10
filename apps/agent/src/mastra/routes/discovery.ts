import { listDiscoveryRuns } from "@copilot/db";
import { registerApiRoute } from "@mastra/core/server";
import { z } from "zod";
import { BACKFILL_DAYS } from "../../discovery/run";
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
