/** A provider failure worth retrying: network error, timeout, HTTP 429 or 5xx. */
export class RetryableError extends Error {}

export type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, error: Error) => void | Promise<void>;
};

/**
 * Bounded retries with exponential backoff (base, 2×base, …). Only RetryableError is retried;
 * an abort stops immediately. The last error is rethrown.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 2, baseDelayMs = 500, signal, onRetry } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof RetryableError) || attempt >= retries || signal?.aborted) throw error;
      await onRetry?.(attempt + 1, error);
      await sleep(baseDelayMs * 2 ** attempt, signal);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
