// Per-run research budget, enforced in app code. Spend is an ESTIMATE from a static price
// table (providers don't return cost), so the monetary cap is soft: a call in flight when the
// cap is crossed still finishes and may still be billed.

/** USD per million tokens (input, output). Anthropic list prices as of 2026-10-06. */
export const LLM_PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "anthropic/claude-sonnet-5.5": { input: 2, output: 10 },
  "anthropic/claude-haiku-5.5": { input: 0.1, output: 0.5 },
};
/** Fallback for unknown models: priced like the most expensive entry. */
const UNKNOWN_MODEL = { input: 2, output: 10 };

/** Tavily: 1 credit per basic search, 1 credit per 5 basic extracts. USD per credit is an estimate. */
export const TAVILY_USD_PER_CREDIT = 0.008;
export const PROVIDER_CALL_USD = {
  search: TAVILY_USD_PER_CREDIT,
  extract: TAVILY_USD_PER_CREDIT / 5,
} as const;

export type BudgetLimits = { maxToolCalls: number; maxMs: number; maxUsd: number };
export const DEFAULT_LIMITS: BudgetLimits = { maxToolCalls: 12, maxMs: 120_000, maxUsd: 0.5 };

export type ProviderCall = keyof typeof PROVIDER_CALL_USD;
export type LimitReason = "tool_calls" | "time" | "spend" | "cancelled";

export type BudgetSnapshot = {
  toolCalls: number;
  elapsedMs: number;
  estimatedLlmUsd: number;
  estimatedProviderUsd: number;
  limits: BudgetLimits;
  limitedBy: LimitReason | null;
};

export class ResearchBudget {
  readonly controller = new AbortController();
  private toolCalls = 0;
  private llmUsd = 0;
  private providerUsd = 0;
  private limitedBy: LimitReason | null = null;
  private readonly started: number;
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(
    readonly limits: BudgetLimits = DEFAULT_LIMITS,
    parent?: AbortSignal,
    private readonly now: () => number = Date.now,
  ) {
    this.started = now();
    this.timer = setTimeout(() => this.stop("time"), limits.maxMs);
    // An already-aborted signal never fires "abort" again.
    if (parent?.aborted) this.stop("cancelled");
    else parent?.addEventListener("abort", () => this.stop("cancelled"), { once: true });
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Reserve-before-call: counts the call and its estimated cost, or refuses it. */
  reserve(call: ProviderCall): { ok: true } | { ok: false; reason: LimitReason } {
    const blocked = this.check();
    if (blocked) return { ok: false, reason: blocked };
    if (this.toolCalls + 1 > this.limits.maxToolCalls) return this.refuse("tool_calls");
    if (this.spent() + PROVIDER_CALL_USD[call] > this.limits.maxUsd) return this.refuse("spend");
    this.toolCalls += 1;
    this.providerUsd += PROVIDER_CALL_USD[call];
    return { ok: true };
  }

  /** Adds one LLM step's usage; aborts the run once the spend estimate exceeds the cap. */
  addLlmUsage(modelId: string, usage: { inputTokens?: number; outputTokens?: number }) {
    const price = LLM_PRICES_PER_MTOK[modelId] ?? UNKNOWN_MODEL;
    this.llmUsd +=
      ((usage.inputTokens ?? 0) * price.input + (usage.outputTokens ?? 0) * price.output) / 1e6;
    if (this.spent() > this.limits.maxUsd) this.stop("spend");
  }

  stop(reason: LimitReason) {
    this.limitedBy ??= reason;
    clearTimeout(this.timer);
    if (!this.controller.signal.aborted) this.controller.abort(new Error(`budget: ${reason}`));
  }

  finish() {
    clearTimeout(this.timer);
  }

  snapshot(): BudgetSnapshot {
    return {
      toolCalls: this.toolCalls,
      elapsedMs: this.now() - this.started,
      estimatedLlmUsd: round(this.llmUsd),
      estimatedProviderUsd: round(this.providerUsd),
      limits: this.limits,
      limitedBy: this.limitedBy,
    };
  }

  private spent() {
    return this.llmUsd + this.providerUsd;
  }

  private check(): LimitReason | null {
    if (this.limitedBy) return this.limitedBy;
    if (this.now() - this.started >= this.limits.maxMs) {
      this.stop("time");
      return "time";
    }
    return null;
  }

  private refuse(reason: LimitReason): { ok: false; reason: LimitReason } {
    // A refused call ends the run: nothing more can be scheduled.
    this.limitedBy ??= reason;
    return { ok: false, reason };
  }
}

const round = (usd: number) => Math.round(usd * 10_000) / 10_000;
