import { Memory } from "@mastra/memory";
import { getModel } from "./models";

/**
 * Chat memory: one thread per chat, all under the single local resource.
 * Only the thread's own recent messages are recalled (no semantic recall, no
 * resource-scoped working memory), so chats never see each other's context.
 */
export const chatMemory = new Memory({
  options: {
    lastMessages: 20,
    semanticRecall: false,
    workingMemory: { enabled: false },
    generateTitle: {
      model: () => getModel("fast"),
      instructions:
        "Write a short title (at most 6 words) for this chat, based on the user's first message. " +
        "Name the company or role when one is mentioned. Reply with the title only, without quotes.",
      // Streams a `data-thread-title` chunk before `finish`, so the sidebar updates without polling.
      emitEvent: true,
    },
  },
});
