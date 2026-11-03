import { gateway } from "@ai-sdk/gateway";
import type { LanguageModelV4, LanguageModelV4Prompt } from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { env } from "../env";

export type ModelRole = "main" | "fast";

/**
 * Native AI Gateway provider (not the `vercel/` router string), so provider-specific
 * usage such as cache and reasoning tokens is preserved.
 */
export function getModel(role: ModelRole): LanguageModelV4 {
  const modelId = role === "main" ? env.COPILOT_MODEL : env.COPILOT_FAST_MODEL;
  return env.LLM_MODE === "mock" ? createMockModel(modelId) : gateway(modelId);
}

/** Deterministic model for tests and offline dev: echoes the latest user text. */
export function createMockModel(modelId = "mock"): LanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "mock",
    modelId,
    doGenerate: async ({ prompt }) => {
      const reply = mockReply(prompt);
      return {
        content: [{ type: "text", text: reply }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: mockUsage(reply.split(" ").length),
        warnings: [],
      };
    },
    doStream: async ({ prompt }) => {
      const words = mockReply(prompt).split(/(?<= )/);
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            ...words.map((delta) => ({ type: "text-delta" as const, id: "t1", delta })),
            { type: "text-end", id: "t1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: mockUsage(words.length),
            },
          ],
          chunkDelayInMs: 5,
        }),
      };
    },
  });
}

function mockReply(prompt: LanguageModelV4Prompt): string {
  return `Mock reply: ${lastUserText(prompt)}`;
}

function mockUsage(outputTokens: number) {
  return {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
  };
}

function lastUserText(prompt: LanguageModelV4Prompt): string {
  const user = prompt.findLast((m) => m.role === "user");
  if (!user || typeof user.content === "string") return "";
  return user.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join(" ")
    .trim();
}
