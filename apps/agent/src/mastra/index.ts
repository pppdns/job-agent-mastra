import { LOCAL_USER_ID } from "@copilot/shared";
import { Mastra } from "@mastra/core/mastra";
import { SimpleAuth } from "@mastra/core/server";
import { PinoLogger } from "@mastra/loggers";
import { MastraStorageExporter, Observability, SensitiveDataFilter } from "@mastra/observability";
import { env } from "../env";
import { allScorers } from "../evals/scorers";
import { onServerError } from "../sentry";
import { copilotAgent } from "./agents/copilot";
import { researcherAgent } from "./agents/researcher";
import { chatResumeRoute, chatRoute, chatStopRoute } from "./routes/chat";
import { assessJobRoute, discoveryRunRoute, discoveryStopRoute } from "./routes/discovery";
import { threadMessagesRoute } from "./routes/thread-messages";
import { createStorage } from "./storage";
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

export const mastra = new Mastra({
  agents: { copilotAgent, researcherAgent },
  workflows: { discoverJobsWorkflow },
  scorers: allScorers,
  storage: createStorage(),
  logger,
  observability: new Observability({
    configs: {
      default: {
        serviceName: "copilot-agent",
        exporters: [new MastraStorageExporter()],
        spanOutputProcessors: [traceRedaction],
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
    ],
  },
});

// Worktrees copy the main checkout's database, schedule row included: drop it where the
// schedule is off, so only the main checkout's dev server ever fires discovery.
if (!discoveryScheduleEnabled()) {
  mastra.schedules
    .get(DISCOVER_JOBS_SCHEDULE_ID)
    .then((schedule) => (schedule ? mastra.schedules.delete(DISCOVER_JOBS_SCHEDULE_ID) : undefined))
    .catch((error) =>
      logger.warn("could not check the discovery schedule", { error: String(error) }),
    );
}
