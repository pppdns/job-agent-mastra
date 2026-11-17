import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { Agent } from "@mastra/core/agent";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { CACHE_BREAKPOINT, cachedUserMessage } from "./models";

/** A model that records the prompt Mastra hands to the provider. */
function capturingModel() {
  const calls: LanguageModelV4CallOptions[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      calls.push(options);
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
  return { model, calls };
}

// Anthropic caches only up to a cache_control marker, so the markers must survive Mastra's
// message handling all the way to the provider call.
describe("cache breakpoints", () => {
  it("keeps the marker on the shared prefix part, not on the job's part", async () => {
    const { model, calls } = capturingModel();
    const agent = new Agent({ id: "t", name: "t", instructions: "Be brief.", model });
    await agent.generate(cachedUserMessage({ prefix: "Profile: x", rest: "Job: y" }));
    const user = calls[0]?.prompt.find((m) => m.role === "user");
    const parts = (user?.content ?? []) as { text?: string; providerOptions?: object }[];
    expect(parts.map((p) => p.text)).toEqual(["Profile: x", "Job: y"]);
    expect(parts[0]?.providerOptions).toMatchObject(CACHE_BREAKPOINT);
    expect(parts[1]?.providerOptions).not.toHaveProperty("anthropic");
  });

  it("keeps the marker on a system-message instruction", async () => {
    const { model, calls } = capturingModel();
    const agent = new Agent({
      id: "t",
      name: "t",
      instructions: { role: "system", content: "Rules.", providerOptions: CACHE_BREAKPOINT },
      model,
    });
    await agent.generate("Listing: z");
    expect(calls[0]?.prompt[0]).toMatchObject({
      role: "system",
      content: "Rules.",
      providerOptions: CACHE_BREAKPOINT,
    });
  });
});
