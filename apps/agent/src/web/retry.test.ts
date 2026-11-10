import { describe, expect, it } from "vitest";
import { RetryableError, retryAfterMs, withRetry } from "./retry";

describe("withRetry", () => {
  it("retries retryable errors up to the limit, reporting each retry", async () => {
    let calls = 0;
    const retries: number[] = [];
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new RetryableError("503");
        return "ok";
      },
      { baseDelayMs: 1, onRetry: (n) => void retries.push(n) },
    );
    expect(result).toBe("ok");
    expect(retries).toEqual([1, 2]);
  });

  it("gives up after the limit and never retries other errors", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new RetryableError("429");
        },
        { retries: 2, baseDelayMs: 1 },
      ),
    ).rejects.toThrow("429");
    expect(calls).toBe(3);

    calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error("400 bad request");
        },
        { baseDelayMs: 1 },
      ),
    ).rejects.toThrow("400");
    expect(calls).toBe(1);
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new RetryableError("503");
        },
        { signal: controller.signal, baseDelayMs: 1 },
      ),
    ).rejects.toThrow("503");
    expect(calls).toBe(1);
  });
});

describe("Retry-After", () => {
  it("reads seconds and HTTP dates", () => {
    expect(retryAfterMs("3")).toBe(3_000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 4_000)).toBe(6_000);
    expect(retryAfterMs(null)).toBeUndefined();
    expect(retryAfterMs("soon")).toBeUndefined();
  });

  it("waits as long as the server asks, and gives up when that is too long", async () => {
    let calls = 0;
    const started = Date.now();
    await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw new RetryableError("429", 120);
        return "ok";
      },
      { baseDelayMs: 1 },
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(110);

    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new RetryableError("429", 10 * 60_000);
        },
        { baseDelayMs: 1 },
      ),
    ).rejects.toThrow("429");
    expect(attempts).toBe(1);
  });
});
