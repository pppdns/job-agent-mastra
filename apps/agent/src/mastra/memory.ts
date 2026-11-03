import { Memory } from "@mastra/memory";
import { getModel } from "./models";

/**
 * Chat memory: one thread per chat, all under the single local resource.
 * Only the thread's own recent messages and its own working memory are recalled (no
 * semantic recall, nothing resource-scoped), so chats never see each other's context.
 * Durable facts about the user live in the approved profile (app tables), not here.
 */
export const chatMemory = new Memory({
  options: {
    lastMessages: 20,
    semanticRecall: false,
    workingMemory: {
      enabled: true,
      scope: "thread",
      template: `# This chat only (not part of the approved profile)
- Local assumptions and exceptions:
- Open questions:
`,
    },
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
