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

/**
 * Deterministic model for tests and offline dev. Echoes the latest user text, except:
 * a bare URL or a message starting with "Listing:" calls ingest_listing (when the tool is
 * offered), and a tool result is answered with its status.
 */
export function createMockModel(modelId = "mock"): LanguageModelV4 {
  const usage = (outputTokens: number) => ({
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
  });
  return new MockLanguageModelV4({
    provider: "mock",
    modelId,
    doGenerate: async (options) => {
      const turn = mockTurn(options);
      return {
        content:
          turn.kind === "tool"
            ? [
                {
                  type: "tool-call",
                  toolCallId: "mock-call",
                  toolName: turn.toolName,
                  input: turn.input,
                },
              ]
            : [{ type: "text", text: turn.text }],
        finishReason:
          turn.kind === "tool"
            ? { unified: "tool-calls", raw: "tool_use" }
            : { unified: "stop", raw: "stop" },
        usage: usage(turn.kind === "text" ? turn.text.split(" ").length : 1),
        warnings: [],
      };
    },
    doStream: async (options) => {
      const turn = mockTurn(options);
      if (turn.kind === "tool") {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "mock-call",
                toolName: turn.toolName,
                input: turn.input,
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool_use" },
                usage: usage(1),
              },
            ],
            chunkDelayInMs: 5,
          }),
        };
      }
      const words = turn.text.split(/(?<= )/);
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
              usage: usage(words.length),
            },
          ],
          chunkDelayInMs: 5,
        }),
      };
    },
  });
}

type MockTurn = { kind: "text"; text: string } | { kind: "tool"; toolName: string; input: string };

function mockTurn({
  prompt,
  tools,
}: {
  prompt: LanguageModelV4Prompt;
  tools?: { name: string }[];
}): MockTurn {
  const last = prompt.at(-1);
  if (last?.role === "tool") {
    const result = last.content.find((part) => part.type === "tool-result");
    const output = result?.output;
    const status =
      output?.type === "json" && output.value && typeof output.value === "object"
        ? (output.value as { status?: string }).status
        : undefined;
    return { kind: "text", text: `Mock reply: ${result?.toolName} ${status ?? "done"}` };
  }
  const text = lastUserText(prompt);
  if (tools?.some((t) => t.name === "ingest_listing")) {
    if (/^https?:\/\/\S+$/.test(text)) {
      return { kind: "tool", toolName: "ingest_listing", input: JSON.stringify({ url: text }) };
    }
    if (text.startsWith("Listing:")) {
      return {
        kind: "tool",
        toolName: "ingest_listing",
        input: JSON.stringify({ fromLatestUserMessage: true }),
      };
    }
  }
  return { kind: "text", text: `Mock reply: ${text}` };
}

function lastUserText(prompt: LanguageModelV4Prompt): string {
  const user = prompt.findLast((m) => m.role === "user");
  if (!user || typeof user.content === "string") return "";
  return user.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join(" ")
    .trim();
}
