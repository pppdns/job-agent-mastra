import { LOCAL_USER_ID } from "@copilot/shared";
import type { ChatRequest } from "@/lib/chat-schema";

/** The only body shape the web server sends to the agent's /chat route. */
export function toAgentChatBody({ threadId, message }: ChatRequest) {
  return {
    // With memory, Mastra loads earlier messages from storage: send only the new one.
    messages: [message],
    memory: { thread: threadId, resource: LOCAL_USER_ID },
  };
}
