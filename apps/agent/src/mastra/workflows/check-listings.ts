import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { httpJson } from "../../discovery/sources/http";
import { emailConfig } from "../../email";
import { env } from "../../env";
import { LISTING_SITES } from "../../listings/checkers";
import { sendClosedEmail } from "../../listings/report";
import { runListingCheck } from "../../listings/run";
import { reportError } from "../../sentry";
import { getAppDb } from "../app-db";
import { discoveryScheduleEnabled } from "./discover-jobs";

// Daily listing check: re-checks the links of shortlisted, to-apply and top new jobs, dismisses those whose
// listing closed, and emails the list. See src/listings/AGENTS.md.

export const CHECK_LISTINGS_WORKFLOW_ID = "check-listings";
export const CHECK_LISTINGS_SCHEDULE_ID = `wf_${CHECK_LISTINGS_WORKFLOW_ID}`;
/** Before the morning discovery run (07:00), so the digest's job list is already clean. */
export const CHECK_LISTINGS_CRON = "30 6 * * *";

const inputSchema = z.object({
  /** Report what would be dismissed without changing anything or sending email. */
  dryRun: z.boolean().default(false),
  /** Most jobs checked (default: all in scope, up to 500). */
  limit: z.number().int().positive().max(2_000).nullish(),
});

const closedSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  company: z.string().nullable(),
  previousStatus: z.string(),
  url: z.string(),
  site: z.enum(LISTING_SITES),
  signal: z.string(),
});

const outputSchema = z.object({
  dryRun: z.boolean(),
  jobs: z.number(),
  checks: z.number(),
  open: z.number(),
  unknown: z.number(),
  unsupported: z.number(),
  closed: z.array(closedSchema),
  rateLimited: z.array(z.enum(LISTING_SITES)),
  unknownSignals: z.record(z.string(), z.number()),
  email: z.object({ status: z.enum(["sent", "skipped", "failed"]), message: z.string() }),
});

const check = createStep({
  id: "check-listings",
  description: "Checks listing links, dismisses jobs whose listing closed, emails the list",
  inputSchema,
  outputSchema,
  execute: async ({ inputData, abortSignal, mastra }) => {
    const db = await getAppDb();
    try {
      const result = await runListingCheck(db, {
        dryRun: inputData.dryRun,
        limit: inputData.limit ?? undefined,
        signal: abortSignal,
      });
      const email = inputData.dryRun
        ? { status: "skipped" as const, message: "dry run" }
        : await sendClosedEmail(httpJson, emailConfig(), result.closed);
      if (email.status === "failed") reportError(new Error(email.message), { area: "listings" });
      mastra
        ?.getLogger()
        ?.info(
          `listing check: ${result.jobs} jobs, ${result.checks} checks, ${result.closed.length} closed, ${result.unknown} unknown${result.rateLimited.length > 0 ? `, rate limited: ${result.rateLimited.join(", ")}` : ""}; email ${email.status}`,
        );
      return { dryRun: inputData.dryRun, ...result, email };
    } catch (error) {
      if (!abortSignal?.aborted) reportError(error, { area: "listings" });
      throw error;
    }
  },
});

export const checkListingsWorkflow = createWorkflow({
  id: CHECK_LISTINGS_WORKFLOW_ID,
  description:
    "Re-checks the listings of shortlisted, to-apply and top new jobs, dismisses closed ones and emails the list",
  inputSchema,
  outputSchema,
  options: { autoRestartActiveRuns: false },
  // Same rule as discovery: only production or the main checkout's dev server schedules it.
  ...(discoveryScheduleEnabled()
    ? {
        schedule: {
          cron: CHECK_LISTINGS_CRON,
          timezone: env.DISCOVERY_TZ,
          inputData: { dryRun: false },
        },
      }
    : {}),
})
  .then(check)
  .commit();
