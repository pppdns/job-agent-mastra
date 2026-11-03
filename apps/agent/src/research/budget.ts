import { estimateLlmUsd, estimateProviderUsd, type TokenUsage } from "../usage/prices";

// Per-run research budget, enforced in app code. Spend is an ESTIMATE from a static price
// table (providers don't return cost), so the monetary cap is soft: a call in flight when the
// cap is crossed still finishes and may still be billed.

/** Estimated USD per provider call kind, reserved before each call. */
export const PROVIDER_CALL_USD = {
  search: estimateProviderUsd({ provider: "tavily", op: "search" }),
  extract: estimateProviderUsd({ provider: "tavily", op: "extract", depth: "basic" }),
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
  addLlmUsage(modelId: string, usage: TokenUsage) {
    this.llmUsd += estimateLlmUsd(modelId, usage);
    if (this.spent() > this.limits.maxUsd) this.stop("spend");
  }

  /** Provider calls still allowed (recording claims is free). */
  remainingCalls(): number {
    return Math.max(0, this.limits.maxToolCalls - this.toolCalls);
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
