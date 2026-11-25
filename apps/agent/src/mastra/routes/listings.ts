import { LISTING_SCOPES } from "@copilot/db";
import { type ContextWithMastra, registerApiRoute } from "@mastra/core/server";
import { z } from "zod";
import {
  cancelListingCheckReservation,
  listingCheckBusy,
  reserveListingCheck,
} from "../../listings/lock";
import { CHECK_LISTINGS_WORKFLOW_ID } from "../workflows/check-listings";

// "Check listings" on /discovery: start the check-listings workflow by hand, and report the
// running or last run. Runs live only in Mastra's workflow storage (no app table); whether one is
// running comes from the in-process lock (src/listings/lock.ts), so a run that died with a
// restart (no auto-restart) shows as interrupted and never blocks.

const WORKFLOW_KEY = "checkListingsWorkflow";

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

const workflowOf = (c: ContextWithMastra) => c.get("mastra").getWorkflow(WORKFLOW_KEY);

/** GET /listings/check — the running run (if any) and the latest run with its result. */
export const listingCheckStatusRoute = registerApiRoute("/listings/check", {
  method: "GET",
  handler: async (c) => {
    const workflow = workflowOf(c);
    const live = listingCheckBusy();
    // Newest first (the libsql adapter orders by createdAt DESC).
    const { runs } = await workflow.listWorkflowRuns({ page: 0, perPage: 1 });
    const latest = runs[0];
    if (!latest) return c.json({ running: live, last: null });
    const state = await workflow.getWorkflowRunById(latest.runId);
    const status = state?.status ?? "unknown";
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
    // Reserved synchronously, before any await, so a second click gets 409.
    if (!reserveListingCheck()) return c.json({ error: "A listing check is running" }, 409);
    try {
      const run = await workflowOf(c).createRun();
      const { runId } = await run.startAsync({
        inputData: { dryRun: false, scopes: parsed.data.scopes, trigger: "manual" },
        tracingOptions: {
          rootSpanName: `check-listings (manual: ${parsed.data.scopes.join(", ")})`,
        },
      });
      return c.json({ workflowRunId: runId, workflowId: CHECK_LISTINGS_WORKFLOW_ID }, 202);
    } catch (error) {
      cancelListingCheckReservation();
      throw error;
    }
  },
});
