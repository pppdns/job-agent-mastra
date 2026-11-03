import { describe, expect, it } from "vitest";
import { RetryableError, withRetry } from "./retry";

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
