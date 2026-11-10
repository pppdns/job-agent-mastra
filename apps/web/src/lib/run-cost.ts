import type { DiscoveryRun, ModelSpend } from "@copilot/db";

export type RunCost = { apifyUsd: number; triageUsd: number; assessUsd: number; totalUsd: number };

/**
 * A run's estimated cost by kind: paid sources (Apify) and model calls, from the run's usage
 * events, so it grows while the run is going. Without events it falls back to the funnel's
 * model total (counted as triage, which most of it is).
 */
export function runCost(
  run: Pick<DiscoveryRun, "sources" | "funnel">,
  spend: ModelSpend | undefined,
): RunCost {
  const apifyUsd = run.sources.reduce((sum, s) => sum + s.costUsd, 0);
  const { triageUsd, assessUsd } = spend ?? {
    triageUsd: run.funnel?.llmUsd ?? 0,
    assessUsd: 0,
  };
  return { apifyUsd, triageUsd, assessUsd, totalUsd: apifyUsd + triageUsd + assessUsd };
}

/** "Apify $1.48 · triage $0.40 · assessments $0.58", leaving out what cost nothing. */
export function costParts(cost: RunCost, usd: (n: number) => string): string[] {
  return [
    cost.apifyUsd > 0 && `Apify ${usd(cost.apifyUsd)}`,
    cost.triageUsd > 0 && `triage ${usd(cost.triageUsd)}`,
    cost.assessUsd > 0 && `assessments ${usd(cost.assessUsd)}`,
  ].filter((p): p is string => Boolean(p));
}
