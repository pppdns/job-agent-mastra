import type { MastraDBMessage, MastraToolInvocation } from "@mastra/core/agent/message-list";
import { describe, expect, it } from "vitest";
import { caseExpectationsScorer, noToolErrorsScorer, toolRuns } from "./scorers";

let n = 0;
const assistant = (...calls: Partial<MastraToolInvocation>[]): MastraDBMessage =>
  ({
    id: `m${++n}`,
    role: "assistant",
    createdAt: new Date(),
    content: {
      format: 2,
      parts: calls.map((call) => ({
        type: "tool-invocation",
        toolInvocation: { toolCallId: `c${++n}`, args: {}, state: "result", ...call },
      })),
    },
  }) as MastraDBMessage;

const draft = (fitBasis: string | null) => ({ assessment: fitBasis ? { fitBasis } : undefined });

// A run where the model's first save_job_draft had unparseable arguments, then it retried.
const retried = [
  assistant(
    { toolName: "ingest_listing", result: { status: "saved" } },
    {
      toolName: "save_job_draft",
      args: draft(null),
      state: "output-error",
      errorText: "invalid arguments",
    },
    { toolName: "save_job_draft", args: draft("with_profile"), result: { ok: true } },
  ),
];

describe("toolRuns", () => {
  it("marks thrown, unfinished and error-result calls as failed", () => {
    const runs = toolRuns([
      assistant(
        { toolName: "a", state: "output-error", errorText: "bad json" },
        { toolName: "b", state: "call" },
        { toolName: "c", result: { ok: false, error: "source ids x are not sources" } },
        { toolName: "d", result: { ok: true } },
      ),
    ]);
    expect(runs.map((r) => r.error)).toEqual([
      "bad json",
      "no result",
      "source ids x are not sources",
      undefined,
    ]);
  });
});

describe("noToolErrorsScorer", () => {
  it("names the failed tool and its error in the reason", async () => {
    const result = await noToolErrorsScorer.run({ input: undefined, output: retried });
    expect(result.score).toBe(0);
    expect(result.reason).toContain("save_job_draft: invalid arguments");
  });
});

describe("caseExpectationsScorer", () => {
  it("ignores rejected drafts when checking fitBasis", async () => {
    const result = await caseExpectationsScorer.run({
      input: undefined,
      output: retried,
      groundTruth: { mustCall: ["save_job_draft"], fitBasis: "with_profile" },
    });
    expect(result.score).toBe(1);
  });

  it("still fails a saved draft with the wrong basis", async () => {
    const output = [
      assistant({ toolName: "save_job_draft", args: draft("role_only"), result: { ok: true } }),
    ];
    const result = await caseExpectationsScorer.run({
      input: undefined,
      output,
      groundTruth: { fitBasis: "with_profile" },
    });
    expect(result.score).toBe(0);
  });
});
