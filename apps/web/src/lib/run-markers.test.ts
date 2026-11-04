import { describe, expect, it } from "vitest";
import { markerFor, parseSeen, seenAtOf } from "./run-markers";

describe("markerFor", () => {
  it("shows running chats, even the open one", () => {
    expect(markerFor({ status: "running", endedAt: null }, 0, true)).toBe("running");
  });

  it("marks replies that ended after the chat was last seen", () => {
    expect(markerFor({ status: "completed", endedAt: 20 }, 10, false)).toBe("done");
    expect(markerFor({ status: "failed", endedAt: 20 }, 10, false)).toBe("failed");
    expect(markerFor({ status: "interrupted", endedAt: 20 }, 10, false)).toBe("failed");
    expect(markerFor({ status: "completed", endedAt: 5 }, 10, false)).toBeNull();
  });

  it("hides the dot for the open chat and stopped runs", () => {
    expect(markerFor({ status: "completed", endedAt: 20 }, 10, true)).toBeNull();
    expect(markerFor({ status: "cancelled", endedAt: 20 }, 10, false)).toBeNull();
    expect(markerFor(undefined, 0, false)).toBeNull();
  });
});

describe("seen state", () => {
  it("starts fresh on missing or broken storage", () => {
    expect(parseSeen(null, 7)).toEqual({ since: 7, threads: {} });
    expect(parseSeen("{oops", 7)).toEqual({ since: 7, threads: {} });
  });

  it("falls back to the first-load time for chats never opened", () => {
    const seen = parseSeen(JSON.stringify({ since: 3, threads: { a: 9 } }), 100);
    expect(seenAtOf(seen, "a")).toBe(9);
    expect(seenAtOf(seen, "b")).toBe(3);
  });
});
