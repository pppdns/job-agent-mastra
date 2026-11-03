import type { LanguageModelV4Prompt } from "@ai-sdk/provider";
import { LOCAL_USER_ID } from "@copilot/shared";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it } from "vitest";
import { chatMemory } from "./memory";
import { loadThreadUIMessages } from "./routes/thread-messages";

/** Model that records every prompt it receives, so tests can inspect the context. */
function recordingModel(prompts: LanguageModelV4Prompt[]) {
  return new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      prompts.push(prompt);
      return {
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}

describe("chat memory", () => {
  let prompts: LanguageModelV4Prompt[];
  let agent: Agent;

  beforeEach(() => {
    prompts = [];
    agent = new Agent({
      id: "memory-test",
      name: "Memory test",
      instructions: "Test agent.",
      model: recordingModel(prompts),
      memory: chatMemory,
    });
    new Mastra({
      agents: { agent },
      storage: new LibSQLStore({ id: "memory-test", url: ":memory:" }),
      logger: false,
    });
  });

  const run = (text: string, thread: string, resource = LOCAL_USER_ID) =>
    agent.generate(text, { memory: { thread, resource } });

  it("recalls earlier messages of the same thread", async () => {
    await run("My codename is ALPHA-7", "thread-a");
    await run("What is my codename?", "thread-a");
    expect(JSON.stringify(prompts.at(-1))).toContain("ALPHA-7");
  });

  it("does not leak context between threads of the same resource", async () => {
    await run("My codename is ALPHA-7", "thread-a");
    await run("What is my codename?", "thread-b");
    expect(JSON.stringify(prompts.at(-1))).not.toContain("ALPHA-7");
  });

  it("rejects a thread owned by another resource", async () => {
    await run("My codename is ALPHA-7", "thread-a");
    await expect(run("What is my codename?", "thread-a", "intruder")).rejects.toThrow(
      /belongs to resource/,
    );
  });

  it("loads UI history only for the owning resource", async () => {
    await run("My codename is ALPHA-7", "thread-a");
    const memory = await agent.getMemory();
    if (!memory) throw new Error("memory missing");

    const own = await loadThreadUIMessages(memory, "thread-a", LOCAL_USER_ID);
    expect(own?.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(own?.[0]?.parts)).toContain("ALPHA-7");

    expect(await loadThreadUIMessages(memory, "thread-a", "intruder")).toBeNull();
    expect(await loadThreadUIMessages(memory, "missing", LOCAL_USER_ID)).toBeNull();
  });

  it("keeps working memory (local assumptions) inside its own thread", async () => {
    await run("hello", "thread-a");
    await run("hello", "thread-b");
    const memory = await agent.getMemory();
    await memory?.updateWorkingMemory({
      threadId: "thread-a",
      resourceId: LOCAL_USER_ID,
      workingMemory: "- Local assumptions and exceptions: include London roles",
    });
    await run("Any local notes?", "thread-a");
    expect(JSON.stringify(prompts.at(-1))).toContain("include London roles");
    await run("Any local notes?", "thread-b");
    expect(JSON.stringify(prompts.at(-1))).not.toContain("include London roles");
  });
});
