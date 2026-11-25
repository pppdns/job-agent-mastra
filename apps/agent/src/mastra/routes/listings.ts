import { LISTING_SCOPES } from "@copilot/db";
import { type ContextWithMastra, registerApiRoute } from "@mastra/core/server";
import { z } from "zod";
import { CHECK_LISTINGS_WORKFLOW_ID } from "../workflows/check-listings";

// "Check listings" on /discovery: start the check-listings workflow by hand, and report the
// running or last run. Runs live only in Mastra's workflow storage (no app table).

const WORKFLOW_KEY = "checkListingsWorkflow";
/** A run still "running" after this long died with the process (no auto-restart): ignore it. */
const STALE_MS = 2 * 60 * 60 * 1000;

const bodySchema = z.object({ scopes: z.array(z.enum(LISTING_SCOPES)).min(1) });

export type ListingCheckRun = {
  runId: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  /** The workflow's input (scopes, trigger, dryRun). */
  input: Record<string, unknown> | null;
  /** The workflow's output once it succeeded (see outputSchema in check-listings.ts). */
  result: Record<string, unknown> | null;
  error: string | null;
};

async function recentRuns(c: ContextWithMastra) {
  const workflow = c.get("mastra").getWorkflow(WORKFLOW_KEY);
  const { runs } = await workflow.listWorkflowRuns({ page: 0, perPage: 5 });
  const sorted = [...runs].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return { workflow, runs: sorted };
}

const snapshotStatus = (snapshot: unknown) => {
  const parsed = typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot;
  return (parsed as { status?: string } | null)?.status ?? "unknown";
};

const isLive = (run: { snapshot: unknown; createdAt: Date }) =>
  snapshotStatus(run.snapshot) === "running" && Date.now() - +new Date(run.createdAt) < STALE_MS;

/** GET /listings/check — the running run (if any) and the latest run with its result. */
export const listingCheckStatusRoute = registerApiRoute("/listings/check", {
  method: "GET",
  handler: async (c) => {
    const { workflow, runs } = await recentRuns(c);
    const latest = runs[0];
    if (!latest) return c.json({ running: false, last: null });
    const state = await workflow.getWorkflowRunById(latest.runId);
    const status = state?.status ?? snapshotStatus(latest.snapshot);
    const live = isLive(latest);
    const last: ListingCheckRun = {
      runId: latest.runId,
      status: status === "running" && !live ? "interrupted" : status,
      startedAt: new Date(latest.createdAt).toISOString(),
      finishedAt: status === "running" ? null : new Date(latest.updatedAt).toISOString(),
      input: state?.payload ?? null,
      result: status === "success" ? (state?.result ?? null) : null,
      error: state?.error?.message ?? null,
    };
    return c.json({ running: live, last });
  },
});

/** POST /listings/check {scopes} — "Check now": starts a run in the background; 409 while one runs. */
export const listingCheckRunRoute = registerApiRoute("/listings/check", {
  method: "POST",
  handler: async (c) => {
    const parsed = bodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: `scopes: one or more of ${LISTING_SCOPES.join(", ")}` }, 400);
    }
    const { workflow, runs } = await recentRuns(c);
    if (runs.some(isLive)) return c.json({ error: "A listing check is running" }, 409);
    const run = await workflow.createRun();
    const { runId } = await run.startAsync({
      inputData: { dryRun: false, scopes: parsed.data.scopes, trigger: "manual" },
      tracingOptions: { rootSpanName: `check-listings (manual: ${parsed.data.scopes.join(", ")})` },
    });
    return c.json({ workflowRunId: runId, workflowId: CHECK_LISTINGS_WORKFLOW_ID }, 202);
  },
});
