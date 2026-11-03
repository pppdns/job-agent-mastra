import { generateText, streamText } from "ai";
import { describe, expect, it } from "vitest";
import { createMockModel } from "../mastra/models";
import { meteredModel } from "./metered-model";
import type { TokenUsage } from "./prices";

describe("meteredModel", () => {
  it("reports usage for generate and stream calls", async () => {
    const seen: TokenUsage[] = [];
    const model = meteredModel(createMockModel(), (u) => void seen.push(u));
    await generateText({ model, prompt: "hello" });
    await streamText({ model, prompt: "hello there" }).text;
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ inputTokens: 10, cachedInputTokens: 0 });
  });
});
