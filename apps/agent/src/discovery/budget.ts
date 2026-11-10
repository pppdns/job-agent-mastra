import { estimateLlmUsd, type TokenUsage } from "../usage/prices";

// Per-run model budget of discovery, enforced in app code: a cap on triage calls and on
// estimated spend. Reserve-before-call; triage reconciles with real token usage, assessments
// keep their (conservative) reservation. The run's real model cost is summed from its usage
// events at the end.

/** Reserved per triage call (a fast-model call over a ~2–4k token prompt costs far less). */
export const TRIAGE_RESERVE_USD = 0.002;
/** Reserved per full assessment (main model, ~8–12k tokens in, ~2k out). */
export const ASSESS_RESERVE_USD = 0.08;

export class DiscoveryBudget {
  private spentUsd = 0;
  private triageCalls = 0;
  stoppedBy: string | undefined;

  constructor(readonly limits: { maxUsd: number; maxTriage: number }) {}

  get spent() {
    return this.spentUsd;
  }

  /** Reserves one triage call, or refuses (and remembers why). */
  reserveTriage(): boolean {
    if (this.triageCalls >= this.limits.maxTriage) {
      return this.refuse(`per-run triage cap (${this.limits.maxTriage}) reached`);
    }
    if (this.spentUsd + TRIAGE_RESERVE_USD > this.limits.maxUsd) return this.refuseSpend();
    this.triageCalls += 1;
    this.spentUsd += TRIAGE_RESERVE_USD;
    return true;
  }

  /** Replaces a triage reservation with what the call really used. */
  settleTriage(modelId: string, usage: TokenUsage) {
    this.spentUsd += estimateLlmUsd(modelId, usage) - TRIAGE_RESERVE_USD;
  }

  reserveAssessment(): boolean {
    if (this.spentUsd + ASSESS_RESERVE_USD > this.limits.maxUsd) return this.refuseSpend();
    this.spentUsd += ASSESS_RESERVE_USD;
    return true;
  }

  private refuseSpend() {
    return this.refuse(`per-run model spend cap ($${this.limits.maxUsd.toFixed(2)}) reached`);
  }

  private refuse(reason: string) {
    this.stoppedBy ??= reason;
    return false;
  }
}
