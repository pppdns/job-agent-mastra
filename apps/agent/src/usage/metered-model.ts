import type { LanguageModelV4, LanguageModelV4Usage } from "@ai-sdk/provider";
import { wrapLanguageModel } from "ai";
import type { TokenUsage } from "./prices";

/** AI SDK v4 nested usage → the flat shape our price table and events use. */
export function flattenUsage(usage: LanguageModelV4Usage): TokenUsage {
  return {
    inputTokens: usage.inputTokens.total ?? 0,
    outputTokens: usage.outputTokens.total ?? 0,
    cachedInputTokens: usage.inputTokens.cacheRead ?? 0,
    cacheCreationInputTokens: usage.inputTokens.cacheWrite ?? 0,
    reasoningTokens: usage.outputTokens.reasoning ?? 0,
  };
}

/**
 * Reports the usage of every call made with `model`. For model calls outside an agent's
 * steps (e.g. chat title generation), which emit no step chunk the run recorder would see.
 */
export function meteredModel(
  model: LanguageModelV4,
  onUsage: (usage: TokenUsage) => void,
): LanguageModelV4 {
  return wrapLanguageModel({
    model,
    middleware: {
      wrapGenerate: async ({ doGenerate }) => {
        const result = await doGenerate();
        onUsage(flattenUsage(result.usage));
        return result;
      },
      wrapStream: async ({ doStream }) => {
        const result = await doStream();
        return {
          ...result,
          stream: result.stream.pipeThrough(
            new TransformStream({
              transform(part, controller) {
                if (part.type === "finish") onUsage(flattenUsage(part.usage));
                controller.enqueue(part);
              },
            }),
          ),
        };
      },
    },
  });
}
