import type { DiscoveryRun } from "@copilot/db";
import { describe, expect, it } from "vitest";
import { costParts, runCost } from "./run-cost";

const usd = (n: number) => `$${n.toFixed(2)}`;
const run = (over: Partial<DiscoveryRun> = {}) =>
  ({ sources: [{ costUsd: 1.5 }, { costUsd: 0 }], funnel: { llmUsd: 0.9 }, ...over }) as Pick<
    DiscoveryRun,
    "sources" | "funnel"
  >;

describe("runCost", () => {
  it("adds paid sources and model spend from usage events", () => {
    const cost = runCost(run(), { triageUsd: 0.4, assessUsd: 0.6 });
    expect(cost.totalUsd).toBeCloseTo(2.5);
    expect(costParts(cost, usd)).toEqual(["Apify $1.50", "triage $0.40", "assessments $0.60"]);
  });

  it("falls back to the funnel's model total without events", () => {
    const cost = runCost(run({ sources: [] }), undefined);
    expect(cost).toEqual({ apifyUsd: 0, triageUsd: 0.9, assessUsd: 0, totalUsd: 0.9 });
    expect(costParts(cost, usd)).toEqual(["triage $0.90"]);
  });
});
