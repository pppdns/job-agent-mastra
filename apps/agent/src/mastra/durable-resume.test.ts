// M2 spike (kept as a regression test): can a durable run survive a dropped client and be
// re-observed as an AI SDK v7 UI message stream? Findings: docs/spikes/durable-resume.md.
import { LOCAL_USER_ID } from "@copilot/shared";
import { toAISdkStream } from "@mastra/ai-sdk";
import { Agent } from "@mastra/core/agent";
import { createDurableAgent } from "@mastra/core/agent/durable";
import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { readUIMessageStream, simulateReadableStream, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { createChatMemory } from "./memory";

const WORDS = Array.from({ length: 30 }, (_, i) => `w${i}`);
const FULL_REPLY = WORDS.join(" ");

/** Streams one word every 20 ms, so a "disconnect" can land mid-run. */
function slowModel() {
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: WORDS.length, text: WORDS.length, reasoning: 0 },
  };
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          ...WORDS.map((w, i) => ({
            type: "text-delta" as const,
            id: "t1",
            delta: i === 0 ? w : ` ${w}`,
          })),
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
        ],
        chunkDelayInMs: 20,
      }),
    }),
  });
}

async function lastUIMessage(stream: ReadableStream): Promise<UIMessage | undefined> {
  let last: UIMessage | undefined;
  for await (const message of readUIMessageStream({ stream })) last = message;
  return last;
}

const textOf = (message?: UIMessage) =>
  message?.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("") ?? "";

describe("durable agent resume (spike)", () => {
  it("keeps running after the client drops and replays the whole reply on observe", async () => {
    const agent = new Agent({
      id: "durable-spike",
      name: "Durable spike",
      instructions: "Test agent.",
      model: slowModel(),
      memory: createChatMemory(),
    });
    const durable = createDurableAgent({ agent });
    new Mastra({
      agents: { durable },
      storage: new LibSQLStore({ id: "durable-spike", url: ":memory:" }),
      logger: false,
    });

    const memory = { thread: "spike-thread", resource: LOCAL_USER_ID };
    const started = Date.now();
    const { output, runId, cleanup } = await durable.stream("Tell me something", { memory });

    // First client reads a few UI chunks, then disconnects.
    const first = toAISdkStream(output, { from: "agent", version: "v7" }).getReader();
    for (let i = 0; i < 4; i++) await first.read();
    await first.cancel();
    // The reply takes ~600 ms, so the run is still mid-stream here.
    expect(Date.now() - started).toBeLessThan(400);

    // A reconnecting client observes the same run from the start of the cache.
    const observed = await durable.observe(runId);
    const resumed = await lastUIMessage(
      toAISdkStream(observed.output, { from: "agent", version: "v7" }),
    );
    expect(resumed?.role).toBe("assistant");
    expect(textOf(resumed)).toBe(FULL_REPLY);

    // The run finished server-side and persisted both turns to the thread.
    const stored = await (await agent.getMemory())?.recall({
      threadId: memory.thread,
      resourceId: memory.resource,
      perPage: false,
    });
    expect(stored?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    cleanup();

    // Thread ownership is still enforced for durable runs.
    await expect(
      durable.stream("Let me in", { memory: { ...memory, resource: "intruder" } }),
    ).rejects.toThrow(/belongs to resource/);
  });
});
