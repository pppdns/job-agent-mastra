import { describe, expect, it } from "vitest";
import { ResearchBudget } from "./budget";

const limits = (over = {}) => ({ maxToolCalls: 2, maxMs: 60_000, maxUsd: 1, ...over });

describe("ResearchBudget", () => {
  it("reserves calls until the tool-call limit, then refuses and stays limited", () => {
    const b = new ResearchBudget(limits());
    expect(b.reserve("search")).toEqual({ ok: true });
    expect(b.reserve("extract")).toEqual({ ok: true });
    expect(b.reserve("search")).toEqual({ ok: false, reason: "tool_calls" });
    expect(b.snapshot()).toMatchObject({ toolCalls: 2, limitedBy: "tool_calls" });
    b.finish();
  });

  it("refuses a call that would cross the spend cap before making it", () => {
    const b = new ResearchBudget(limits({ maxToolCalls: 100, maxUsd: 0.01 }));
    expect(b.reserve("search")).toEqual({ ok: true }); // 0.008
    expect(b.reserve("search")).toEqual({ ok: false, reason: "spend" });
    b.finish();
  });

  it("aborts when estimated LLM spend exceeds the cap", () => {
    const b = new ResearchBudget(limits({ maxUsd: 0.01 }));
    b.addLlmUsage("anthropic/claude-sonnet-5.5", { inputTokens: 2_000, outputTokens: 1_000 }); // 0.014
    expect(b.signal.aborted).toBe(true);
    expect(b.snapshot()).toMatchObject({ limitedBy: "spend", estimatedLlmUsd: 0.014 });
  });

  it("stops on elapsed time and on parent cancellation", () => {
    let t = 0;
    const timed = new ResearchBudget(limits({ maxMs: 1000 }), undefined, () => t);
    t = 1000;
    expect(timed.reserve("search")).toEqual({ ok: false, reason: "time" });
    expect(timed.signal.aborted).toBe(true);

    const parent = new AbortController();
    const child = new ResearchBudget(limits(), parent.signal);
    parent.abort();
    expect(child.snapshot().limitedBy).toBe("cancelled");
    expect(child.reserve("search")).toEqual({ ok: false, reason: "cancelled" });

    const already = new AbortController();
    already.abort();
    expect(new ResearchBudget(limits(), already.signal).snapshot().limitedBy).toBe("cancelled");
  });
});
