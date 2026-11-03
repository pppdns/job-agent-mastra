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

export const mastra = new Mastra({
  agents: { copilotAgent },
  storage: new LibSQLStore({ id: "copilot-storage", url: resolveDatabaseUrl() }),
  logger: new PinoLogger({ name: "copilot-agent", level: "info" }),
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
    }),
    apiRoutes: [chatRoute({ path: "/chat", agent: COPILOT_AGENT_ID, version: "v7" })],
  },
});
