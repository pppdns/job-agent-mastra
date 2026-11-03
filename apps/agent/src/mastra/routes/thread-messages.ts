import { COPILOT_AGENT_ID } from "@copilot/shared";
import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import type { MastraMemory } from "@mastra/core/memory";
import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { registerApiRoute } from "@mastra/core/server";

/**
 * A thread's stored history as AI SDK v7 UI messages, or null when the thread is
 * missing or owned by another resource (both look the same to the caller).
 */
export async function loadThreadUIMessages(
  memory: MastraMemory,
  threadId: string,
  resourceId: string,
) {
  const thread = await memory.getThreadById({ threadId });
  if (!thread || thread.resourceId !== resourceId) return null;
  const { messages } = await memory.recall({ threadId, resourceId, perPage: false });
  return mergeAssistantRuns(toAISdkMessages(messages, { version: "v7" }));
}

/**
 * One assistant bubble per turn: Mastra can store a multi-step reply as several assistant
 * messages (e.g. around memory buffering); the live stream shows them as one.
 */
export function mergeAssistantRuns<T extends { role: string; parts: unknown[] }>(
  messages: T[],
): T[] {
  const merged: T[] = [];
  for (const message of messages) {
    const previous = merged.at(-1);
    if (previous && previous.role === "assistant" && message.role === "assistant") {
      merged[merged.length - 1] = { ...previous, parts: [...previous.parts, ...message.parts] };
    } else {
      merged.push(message);
    }
  }
  return merged;
}

/** GET /threads/:threadId/ui-messages — history for reopening a chat in `useChat`. */
export const threadMessagesRoute = registerApiRoute("/threads/:threadId/ui-messages", {
  method: "GET",
  handler: async (c) => {
    // Set by SimpleAuth's mapUserToResourceId, never by the client.
    const resourceId = c.get("requestContext").get(MASTRA_RESOURCE_ID_KEY);
    if (typeof resourceId !== "string") return c.json({ error: "Unauthorized" }, 401);

    const memory = await c.get("mastra").getAgentById(COPILOT_AGENT_ID).getMemory();
    if (!memory) return c.json({ error: "Memory is not configured" }, 500);

    const messages = await loadThreadUIMessages(memory, c.req.param("threadId"), resourceId);
    if (!messages) return c.json({ error: "Thread not found" }, 404);
    return c.json({ messages });
  },
});
