// Static price table. Providers don't return cost, so every figure derived from this is an
// ESTIMATE and labelled as such in the UI. LLM list prices: Anthropic as of 2026-10-06, OpenAI
// (AI Gateway catalog) as of 2026-11-11. Add a model here before using it (RESCORE_MODEL).

/** USD per million tokens. Cache reads bill at 10% of input, 5-minute cache writes at 125%. */
export const LLM_PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "anthropic/claude-sonnet-5.5": { input: 2, output: 10 },
  "anthropic/claude-haiku-5.5": { input: 0.1, output: 0.5 },
  "openai/gpt-6-luna": { input: 0.1, output: 0.5 },
};
const UNKNOWN_MODEL = { input: 2, output: 10 };
const CACHE_READ_FACTOR = 0.1;
const CACHE_WRITE_FACTOR = 1.25;

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningTokens?: number;
};

/** inputTokens includes cached and cache-written tokens (AI SDK convention). */
export function estimateLlmUsd(modelId: string, usage: TokenUsage): number {
  const price = LLM_PRICES_PER_MTOK[modelId] ?? UNKNOWN_MODEL;
  const cached = usage.cachedInputTokens ?? 0;
  const written = usage.cacheCreationInputTokens ?? 0;
  const plain = Math.max(0, (usage.inputTokens ?? 0) - cached - written);
  return (
    (plain * price.input +
      cached * price.input * CACHE_READ_FACTOR +
      written * price.input * CACHE_WRITE_FACTOR +
      (usage.outputTokens ?? 0) * price.output) /
    1e6
  );
}

/** Tavily: basic search 1 credit, basic extract 1 credit per 5 URLs, advanced 2 per 5. */
export const TAVILY_USD_PER_CREDIT = 0.008;
/** Firecrawl scrape: 1 credit per page. USD per credit is an estimate. */
export const FIRECRAWL_USD_PER_CREDIT = 0.001;

export type ProviderOperation =
  | { provider: "tavily"; op: "search" }
  | { provider: "tavily"; op: "extract"; depth: "basic" | "advanced" }
  | { provider: "firecrawl"; op: "scrape" };

export function estimateProviderUsd(call: ProviderOperation): number {
  if (call.provider === "firecrawl") return FIRECRAWL_USD_PER_CREDIT;
  if (call.op === "search") return TAVILY_USD_PER_CREDIT;
  return (TAVILY_USD_PER_CREDIT * (call.depth === "advanced" ? 2 : 1)) / 5;
}
