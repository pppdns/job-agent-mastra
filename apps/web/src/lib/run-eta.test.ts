import { describe, expect, it } from "vitest";
import { estimateRemainingMs, formatRemaining } from "./run-eta";

const start = "2026-11-17T10:00:00.000Z";
const at = (minutes: number) => new Date(start).getTime() + minutes * 60_000;

describe("estimateRemainingMs", () => {
  it("extrapolates the pace so far", () => {
    // 100 of 400 in 10 min → 300 more at the same pace is 30 min.
    expect(estimateRemainingMs({ done: 100, total: 400, startedAt: start, now: at(10) })).toBe(
      30 * 60_000,
    );
  });

  it("gives no estimate without enough progress", () => {
    expect(estimateRemainingMs({ done: 0, total: 400, startedAt: start, now: at(10) })).toBeNull();
    expect(estimateRemainingMs({ done: 3, total: 400, startedAt: start, now: at(10) })).toBeNull();
    expect(
      estimateRemainingMs({ done: 20, total: 8000, startedAt: start, now: at(10) }),
    ).toBeNull();
    expect(
      estimateRemainingMs({ done: 50, total: 400, startedAt: start, now: at(0.2) }),
    ).toBeNull();
    expect(
      estimateRemainingMs({ done: 50, total: 400, startedAt: undefined, now: at(10) }),
    ).toBeNull();
  });

  it("gives no estimate once the step is done", () => {
    expect(
      estimateRemainingMs({ done: 400, total: 400, startedAt: start, now: at(10) }),
    ).toBeNull();
  });
});

describe("formatRemaining", () => {
  it("rounds to whole minutes", () => {
    expect(formatRemaining(20_000)).toBe("under a minute");
    expect(formatRemaining(33 * 60_000 + 57_000)).toBe("34m");
    expect(formatRemaining(125 * 60_000)).toBe("2h 5m");
  });
});
