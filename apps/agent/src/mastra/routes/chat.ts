import { COPILOT_AGENT_ID } from "@copilot/shared";
import { handleChatStream } from "@mastra/ai-sdk";
import { registerApiRoute } from "@mastra/core/server";
import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { z } from "zod";
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

/** POST /chat — AI SDK v7 UI message stream for one new user message in one thread. */
export const chatRoute = registerApiRoute("/chat", {
  method: "POST",
  handler: async (c) => {
    const body = chatBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid chat request" }, 400);
    const mastra = c.get("mastra");
    const stream = await handleChatStream({
      mastra,
      agentId: COPILOT_AGENT_ID,
      version: "v7",
      params: {
        messages: body.data.messages as never,
        memory: body.data.memory,
        requestContext: c.get("requestContext"),
        abortSignal: c.req.raw.signal,
      },
      onError: (error) => {
        mastra.getLogger()?.error("chat stream failed", { error });
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
  },
});
