import { resolveDatabaseUrl } from "@copilot/db";
import { COPILOT_AGENT_ID, LOCAL_USER_ID } from "@copilot/shared";
import { chatRoute } from "@mastra/ai-sdk";
import { Mastra } from "@mastra/core/mastra";
import { SimpleAuth } from "@mastra/core/server";
import { LibSQLStore } from "@mastra/libsql";
import { PinoLogger } from "@mastra/loggers";
import { MastraStorageExporter, Observability, SensitiveDataFilter } from "@mastra/observability";
import { env } from "../env";
import { copilotAgent } from "./agents/copilot";
import { researcherAgent } from "./agents/researcher";
import { toClientErrorText } from "./errors";
import { threadMessagesRoute } from "./routes/thread-messages";

const logger = new PinoLogger({ name: "copilot-agent", level: "info" });

export const mastra = new Mastra({
  agents: { copilotAgent, researcherAgent },
  storage: new LibSQLStore({ id: "copilot-storage", url: resolveDatabaseUrl() }),
  logger,
  observability: new Observability({
    configs: {
      default: {
        serviceName: "copilot-agent",
        exporters: [new MastraStorageExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
  server: {
    // Single-user local mode: loopback only, every API call needs the shared secret.
    host: "127.0.0.1",
    port: Number(process.env.AGENT_PORT ?? 4111),
    auth: new SimpleAuth({
      tokens: { [env.AGENT_SHARED_SECRET]: { id: LOCAL_USER_ID } },
      // Pins every memory operation to this resource: Mastra filters thread lists and
      // returns 403 (or a mismatch error on /chat) for threads owned by anyone else.
      mapUserToResourceId: (user) => user.id,
    }),
    apiRoutes: [
      chatRoute({
        path: "/chat",
        agent: COPILOT_AGENT_ID,
        version: "v7",
        onError: (error) => {
          logger.error("chat stream failed", { error });
          return toClientErrorText(error);
        },
      }),
      threadMessagesRoute,
    ],
  },
});
