import { activeRun, endRun, setRunDetails, startRun } from "@copilot/db";
import { COPILOT_AGENT_ID } from "@copilot/shared";
import { toAISdkStream } from "@mastra/ai-sdk";
import type { DurableAgent } from "@mastra/core/agent/durable";
import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { type ContextWithMastra, registerApiRoute } from "@mastra/core/server";
import type { MastraModelOutput } from "@mastra/core/stream";
import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { z } from "zod";
import { env } from "../../env";
import { reportError } from "../../sentry";
import { RunRecorder, registerRecorder, releaseRecorder } from "../../usage/recorder";
import { THREAD_CONTEXT_KEY } from "../agents/copilot";
import { getAppDb } from "../app-db";
import { toClientErrorText } from "../errors";

/** The only body the web proxy sends (see apps/web/src/server/chat-body.ts). */
const chatBodySchema = z.object({
  messages: z.array(z.looseObject({ id: z.string(), role: z.literal("user") })).length(1),
  memory: z.object({ thread: z.string().min(1).max(128), resource: z.string().min(1).max(128) }),
});

/**
 * Mastra emits `tool-input-available` without `input` when a model's tool arguments are not
 * valid JSON (it still returns an error result to the model). AI SDK clients reject such a
 * chunk and drop the whole turn, so report it as the `tool-input-error` it is.
 */
export function sanitizeChunk(chunk: UIMessageChunk): UIMessageChunk {
  if (chunk.type === "tool-input-available" && chunk.input === undefined) {
    return {
      type: "tool-input-error",
      toolCallId: chunk.toolCallId,
      toolName: chunk.toolName,
      input: {},
      errorText: "The model sent tool arguments that were not valid JSON.",
    };
  }
  return chunk;
}

const durable = (c: ContextWithMastra) =>
  c.get("mastra").getAgentById(COPILOT_AGENT_ID) as unknown as DurableAgent;

/** Streams a durable run's output as AI SDK v7 UI chunks. Closing it never stops the run. */
function uiResponse(c: ContextWithMastra, output: MastraModelOutput) {
  const logger = c.get("mastra").getLogger();
  const stream = toAISdkStream(output, {
    from: "agent",
    version: "v7",
    onError: (error) => {
      logger?.error("chat stream failed", { error });
      return toClientErrorText(error);
    },
  });
  return createUIMessageStreamResponse({
    stream: stream.pipeThrough(
      new TransformStream<UIMessageChunk, UIMessageChunk>({
        transform: (chunk, controller) => controller.enqueue(sanitizeChunk(chunk)),
      }),
    ),
  });
}

/** Thread id from the path, after checking it belongs to the authenticated resource. */
async function ownedThread(c: ContextWithMastra): Promise<string | null> {
  const threadId = c.req.param("threadId");
  const resourceId = c.get("requestContext").get(MASTRA_RESOURCE_ID_KEY);
  if (!threadId || typeof resourceId !== "string") return null;
  const memory = await durable(c).getMemory();
  const thread = await memory?.getThreadById({ threadId });
  return thread && thread.resourceId === resourceId ? threadId : null;
}

const FAILED_STATUSES = new Set(["blocked", "unavailable"]);

/** Turns stream chunks into run events: one per model step, tool call and compaction. */
export function recordChunk(recorder: RunRecorder, chunk: { type: string; payload?: unknown }) {
  const p = (chunk.payload ?? {}) as {
    toolCallId?: string;
    toolName?: string;
    args?: unknown;
    result?: unknown;
    isError?: boolean;
    error?: unknown;
    output?: { usage?: Record<string, number> };
  };
  switch (chunk.type) {
    case "text-delta":
      recorder.noteText();
      break;
    case "tool-call":
      if (p.toolCallId) recorder.toolStart(p.toolCallId);
      break;
    case "tool-result": {
      const r = (p.result ?? {}) as { ok?: boolean; status?: string };
      const failed = Boolean(p.isError) || r.ok === false || FAILED_STATUSES.has(r.status ?? "");
      recorder.toolEnd(p.toolCallId ?? "", p.toolName ?? "tool", p.args, p.result, failed);
      break;
    }
    case "tool-error":
      recorder.toolEnd(
        p.toolCallId ?? "",
        p.toolName ?? "tool",
        p.args,
        { error: String(p.error) },
        true,
      );
      break;
    case "step-finish":
      if (p.output?.usage) recorder.llm("copilot", env.COPILOT_MODEL, p.output.usage);
      break;
    case "data-om-activation":
    case "data-om-observation-end":
      recorder.compaction(
        chunk.type.slice("data-om-".length),
        (chunk as { data?: Record<string, unknown> }).data,
      );
      break;
  }
}

/** POST /chat — start a durable run for one new user message in one thread. */
export const chatRoute = registerApiRoute("/chat", {
  method: "POST",
  handler: async (c) => {
    const body = chatBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid chat request" }, 400);
    const { thread } = body.data.memory;
    const db = await getAppDb();
    if (await activeRun(db, thread)) {
      return c.json({ error: "A reply is still running in this chat." }, 409);
    }
    const requestContext = c.get("requestContext");
    requestContext.set(THREAD_CONTEXT_KEY, thread);
    const logger = c.get("mastra").getLogger();

    const recorder = new RunRecorder(db, thread);
    registerRecorder(recorder);
    let traceId: string | undefined;
    const ended = async (status: "completed" | "cancelled" | "failed", error?: unknown) => {
      releaseRecorder(recorder);
      if (error) {
        recorder.error("run", String(error));
        reportError(error, { area: "chat" });
      }
      await recorder.flush();
      if (!recorder.runId) return;
      try {
        await setRunDetails(db, recorder.runId, {
          model: env.COPILOT_MODEL,
          traceId: traceId ?? null,
          ttftMs: recorder.firstTextAt ? recorder.firstTextAt - recorder.startedAt : null,
        });
        await endRun(db, recorder.runId, status, error ? String(error) : undefined);
      } catch (e) {
        logger?.error("could not record run end", { e });
      }
    };

    const result = await durable(c).stream(body.data.messages as never, {
      memory: body.data.memory,
      requestContext,
      maxSteps: 12,
      modelSettings: { maxOutputTokens: 16_000 },
      onChunk: (chunk) => recordChunk(recorder, chunk),
      // No abort on client disconnect: the run continues and can be observed again.
      onFinish: () => ended("completed"),
      onAbort: () => ended("cancelled"),
      onError: ({ error }) => ended("failed", error),
    });
    traceId = result.output.traceId;
    await startRun(db, { id: result.runId, threadId: thread });
    recorder.attach(result.runId);
    return uiResponse(c, result.output);
  },
});

/** GET /chat/:threadId/stream — re-observe the thread's active run (AI SDK `resume`), or 204. */
export const chatResumeRoute = registerApiRoute("/chat/:threadId/stream", {
  method: "GET",
  handler: async (c) => {
    const threadId = await ownedThread(c);
    if (!threadId) return c.json({ error: "Thread not found" }, 404);
    const run = await activeRun(await getAppDb(), threadId);
    if (!run) return c.body(null, 204);
    const { output } = await durable(c).observe(run.id);
    return uiResponse(c, output);
  },
});

/** POST /chat/:threadId/stop — stop the thread's active run (research included). */
export const chatStopRoute = registerApiRoute("/chat/:threadId/stop", {
  method: "POST",
  handler: async (c) => {
    const threadId = await ownedThread(c);
    if (!threadId) return c.json({ error: "Thread not found" }, 404);
    const db = await getAppDb();
    const run = await activeRun(db, threadId);
    if (!run) return c.json({ stopped: false });
    durable(c).abortRunStream(run.id);
    await endRun(db, run.id, "cancelled");
    return c.json({ stopped: true, runId: run.id });
  },
});
