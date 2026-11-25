import { LOCAL_USER_ID } from "@copilot/shared";
import { Mastra } from "@mastra/core/mastra";
import { SpanType } from "@mastra/core/observability";
import { SimpleAuth } from "@mastra/core/server";
import { PinoLogger } from "@mastra/loggers";
import { MastraStorageExporter, Observability, SensitiveDataFilter } from "@mastra/observability";
import { env } from "../env";
import { allScorers } from "../evals/scorers";
import { onServerError, reportError } from "../sentry";
import { copilotAgent } from "./agents/copilot";
import { researcherAgent } from "./agents/researcher";
import { chatResumeRoute, chatRoute, chatStopRoute } from "./routes/chat";
import { assessJobRoute, discoveryRunRoute, discoveryStopRoute } from "./routes/discovery";
import { listingCheckRunRoute, listingCheckStatusRoute } from "./routes/listings";
import { threadMessagesRoute } from "./routes/thread-messages";
import { createStorage } from "./storage";
import { CHECK_LISTINGS_SCHEDULE_ID, checkListingsWorkflow } from "./workflows/check-listings";
import {
  DISCOVER_JOBS_SCHEDULE_ID,
  discoverJobsWorkflow,
  discoveryScheduleEnabled,
} from "./workflows/discover-jobs";

/** Mastra's default sensitive fields plus cookies and token variants; redacts matching keys in every span. */
export const TRACE_SENSITIVE_FIELDS = [
  "password",
  "token",
  "secret",
  "key",
  "apikey",
  "auth",
  "authorization",
  "bearer",
  "bearertoken",
  "jwt",
  "credential",
  "clientsecret",
  "privatekey",
  "refresh",
  "ssn",
  "cookie",
  "setcookie",
  // Matching is exact on the normalized name, so list the common *_token variants too.
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "sessiontoken",
];
const traceRedaction = new SensitiveDataFilter({ sensitiveFields: TRACE_SENSITIVE_FIELDS });

const logger = new PinoLogger({ name: "copilot-agent", level: "info" });
const { storage, pruneObservability } = createStorage();

export const mastra = new Mastra({
  agents: { copilotAgent, researcherAgent },
  workflows: { discoverJobsWorkflow, checkListingsWorkflow },
  scorers: allScorers,
  storage,
  logger,
  observability: new Observability({
    configs: {
      default: {
        serviceName: "copilot-agent",
        exporters: [new MastraStorageExporter()],
        spanOutputProcessors: [traceRedaction],
        // Noise that filled the DuckDB file: one span per streamed chunk, and Mastra's built-in
        // message processors, which recorded the whole prompt three times per call (about half
        // of the stored trace data, mostly discovery triage). Model, step and tool spans stay.
        excludeSpanTypes: [SpanType.MODEL_CHUNK, SpanType.PROCESSOR_RUN],
      },
    },
  }),
  // Source maps keep production stack traces (Sentry, logs) pointing at src/ files.
  bundler: { sourcemap: true },
  server: {
    onError: onServerError,
    // Loopback by default; every API call needs the shared secret. Fly sets AGENT_HOST="::" so
    // `fly proxy` reaches Studio over the private org network (never a public port; docs/deploy.md).
    host: process.env.AGENT_HOST || "127.0.0.1",
    port: Number(process.env.AGENT_PORT ?? 4111),
    auth: new SimpleAuth({
      tokens: { [env.AGENT_SHARED_SECRET]: { id: LOCAL_USER_ID } },
      // Pins every memory operation to this resource: Mastra filters thread lists and
      // returns 403 (or a mismatch error on /chat) for threads owned by anyone else.
      mapUserToResourceId: (user) => user.id,
    }),
    apiRoutes: [
      chatRoute,
      chatResumeRoute,
      chatStopRoute,
      threadMessagesRoute,
      discoveryRunRoute,
      discoveryStopRoute,
      assessJobRoute,
      listingCheckStatusRoute,
      listingCheckRunRoute,
    ],
  },
});

// Worktrees copy the main checkout's database, schedule rows included: drop them where the
// schedule is off, so only the main checkout's dev server ever fires discovery or listing checks.
if (!discoveryScheduleEnabled()) {
  for (const id of [DISCOVER_JOBS_SCHEDULE_ID, CHECK_LISTINGS_SCHEDULE_ID]) {
    mastra.schedules
      .get(id)
      .then((schedule) => (schedule ? mastra.schedules.delete(id) : undefined))
      .catch((error) =>
        logger.warn(`could not check the ${id} schedule`, { error: String(error) }),
      );
  }
}

// Traces, logs and metrics are kept for OBSERVABILITY_MAX_AGE: the DuckDB file otherwise grows
// until the Fly volume is full (about 1 GB on the first day). Mastra never prunes on its own,
// and its docs advise against pruning at startup, so a timer does it a little after boot.
const PRUNE_FIRST_MS = 10 * 60_000;
const PRUNE_EVERY_MS = 6 * 60 * 60_000;
async function pruneTick() {
  try {
    const results = await pruneObservability();
    const deleted = results.reduce((sum, r) => sum + r.deleted, 0);
    // Logged on every run, even with 0 deleted, so `fly logs` shows the job is alive.
    logger.info(
      `observability retention: deleted ${deleted} rows` +
        (results.some((r) => !r.done) ? " (more left for the next run)" : ""),
    );
  } catch (error) {
    logger.warn("observability retention failed", { error: String(error) });
    reportError(error, { task: "observability-retention" });
  }
}
if (process.env.NODE_ENV !== "test") {
  setTimeout(() => {
    void pruneTick();
    setInterval(() => void pruneTick(), PRUNE_EVERY_MS).unref();
  }, PRUNE_FIRST_MS).unref();
}
