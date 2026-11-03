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
                  toolCallId: turn.toolCallId,
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
                toolCallId: turn.toolCallId,
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

type MockTurn =
  | { kind: "text"; text: string }
  | { kind: "tool"; toolName: string; input: string; toolCallId: string };

type ToolResultValue = {
  status?: string;
  ok?: boolean;
  error?: string;
  jobId?: string;
  version?: number;
  source?: { id?: string };
};

/** JSON value of a tool-result part, if any. */
function toolResultValue(part: unknown): ToolResultValue {
  const output = (part as { output?: { type?: string; value?: unknown } } | undefined)?.output;
  return output?.type === "json" && output.value && typeof output.value === "object"
    ? (output.value as ToolResultValue)
    : {};
}

const MOCK_ASSESSMENT = (sourceId: string) => ({
  overview: "Mock assessment of the pasted listing.",
  fitBasis: "role_only",
  strengths: [
    { text: "The listing text was provided.", evidence: "official", sourceIds: [sourceId] },
  ],
  unknowns: [{ question: "What is the salary?", whyItMatters: "Not stated." }],
  recommendation: { verdict: "investigate_further", rationale: "Mock rationale." },
});

function mockTurn({
  prompt,
  tools,
}: {
  prompt: LanguageModelV4Prompt;
  tools?: { name: string }[];
}): MockTurn {
  const offered = (name: string) => tools?.some((t) => t.name === name) ?? false;
  const call = (toolName: string, input: unknown): MockTurn => ({
    kind: "tool",
    toolName,
    input: JSON.stringify(input),
    // Unique per turn: AI SDK matches tool results to calls by id.
    toolCallId: `mock-${toolName}-${prompt.length}`,
  });

  const last = prompt.at(-1);
  if (last?.role === "tool") {
    const part = last.content.find((p) => p.type === "tool-result");
    const value = toolResultValue(part);
    const name = part?.type === "tool-result" ? part.toolName : "tool";
    if (name === "ingest_listing" && value.status === "saved" && value.jobId && value.source?.id) {
      if (offered("save_job_draft")) {
        return call("save_job_draft", {
          jobId: value.jobId,
          assessment: MOCK_ASSESSMENT(value.source.id),
        });
      }
    }
    const outcome =
      value.status ??
      (value.ok === false ? `error ${value.error}` : value.version ? `v${value.version}` : "done");
    return { kind: "text", text: `Mock reply: ${name} ${outcome}` };
  }

  const text = lastUserText(prompt);
  if (offered("ingest_listing") && /^https?:\/\/\S+$/.test(text)) {
    return call("ingest_listing", { url: text });
  }
  if (offered("ingest_listing") && text.startsWith("Listing:")) {
    return call("ingest_listing", { fromLatestUserMessage: true });
  }
  if (offered("propose_profile_change") && text.startsWith("Remember:")) {
    return call("propose_profile_change", {
      changes: [{ op: "add", kind: "soft_preference", text: text.slice(9).trim() }],
      reason: "The user asked me to remember this.",
    });
  }
  if (offered("updateWorkingMemory") && text.startsWith("For this chat:")) {
    return call("updateWorkingMemory", {
      memory: `# This chat only\n- Local assumptions and exceptions: ${text.slice(14).trim()}\n`,
    });
  }
  // Report what the system prompt carries, so e2e can check what a chat can see.
  if (text === "Profile?") {
    const system = systemText(prompt);
    const version = system.match(/Approved profile \(version (\d+)\)/)?.[1] ?? "?";
    const facts = [...system.matchAll(/^- \[fact:[^\]]+\] (.+)$/gm)].map((m) => m[1]);
    return { kind: "text", text: `Mock reply: profile v${version}: ${facts.join("; ") || "none"}` };
  }
  if (text === "Local?") {
    const local = systemText(prompt).match(
      /Local assumptions and exceptions:[ \t]*(\S[^\n]*)/,
    )?.[1];
    return { kind: "text", text: `Mock reply: local ${local?.trim() || "none"}` };
  }
  if (offered("propose_job_snapshot") && text === "Propose snapshot") {
    const jobId = latestJobId(prompt);
    if (jobId) return call("propose_job_snapshot", { jobId });
  }
  return { kind: "text", text: `Mock reply: ${text}` };
}

function systemText(prompt: LanguageModelV4Prompt): string {
  return prompt.flatMap((m) => (m.role === "system" ? [m.content] : [])).join("\n");
}

/** jobId from the most recent tool result in the conversation that carries one. */
function latestJobId(prompt: LanguageModelV4Prompt): string | undefined {
  for (const message of [...prompt].reverse()) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      const jobId = toolResultValue(part).jobId;
      if (jobId) return jobId;
    }
  }
  return undefined;
}

function lastUserText(prompt: LanguageModelV4Prompt): string {
  const user = prompt.findLast((m) => m.role === "user");
  if (!user || typeof user.content === "string") return "";
  return user.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join(" ")
    .trim();
}
