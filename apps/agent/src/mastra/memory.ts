import { Memory } from "@mastra/memory";
import { env } from "../env";
import { getModel } from "./models";

/**
 * Chat memory: one thread per chat, all under the single local resource.
 * Only the thread's own history (compacted by Observational Memory) and its working memory are recalled (no
 * semantic recall, nothing resource-scoped), so chats never see each other's context.
 * Durable facts about the user live in the approved profile (app tables), not here.
 */
export const createChatMemory = ({ messageTokens = env.OM_MESSAGE_TOKENS } = {}) =>
  new Memory({
    options: {
      semanticRecall: false,
      // Compaction: an Observer (fast model) turns older messages into an observation log once
      // unobserved history passes the threshold; raw messages stay in storage. Thread scope, so
      // compacted context never crosses chats. Profile and pending approvals don't depend on
      // it: they are injected from the database every turn.
      observationalMemory: {
        scope: "thread",
        model: () => getModel("fast"),
        observation: {
          messageTokens,
          // These are re-injected from the database every turn; a copy here would go stale.
          instruction:
            "Do not record the user's approved profile, profile changes, or approval statuses: " +
            "the app provides the current versions separately every turn. Do record what was " +
            "discussed in this chat, local assumptions, open questions, and job/approval ids mentioned.",
        },
      },
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

export const chatMemory = createChatMemory();
