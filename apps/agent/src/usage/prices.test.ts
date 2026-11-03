import { describe, expect, it } from "vitest";
import { estimateLlmUsd, estimateProviderUsd } from "./prices";

describe("prices", () => {
  it("prices cached and cache-written input separately", () => {
    // 1M plain input $2 + 1M cache read $0.20 + 1M cache write $2.50 + 1M output $10
    expect(
      estimateLlmUsd("anthropic/claude-sonnet-5.5", {
        inputTokens: 3_000_000,
        cachedInputTokens: 1_000_000,
        cacheCreationInputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeCloseTo(14.7, 6);
  });

  it("prices provider calls", () => {
    expect(estimateProviderUsd({ provider: "tavily", op: "search" })).toBe(0.008);
    expect(
      estimateProviderUsd({ provider: "tavily", op: "extract", depth: "advanced" }),
    ).toBeCloseTo(0.0032);
  });
});
