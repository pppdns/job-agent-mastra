/**
 * A provider failure worth retrying: network error, timeout, HTTP 429 or 5xx. `retryAfterMs`
 * is how long the server asked us to wait (`Retry-After`), when it said.
 */
export class RetryableError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** Longest `Retry-After` we wait for; asking for more means "not this run". */
export const MAX_RETRY_AFTER_MS = 60_000;

/** `Retry-After` as milliseconds: seconds or an HTTP date; undefined when absent or unreadable. */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1_000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

export type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, error: Error) => void | Promise<void>;
};

/**
 * Bounded retries with exponential backoff (base, 2×base, …), or the server's `Retry-After`
 * when longer. Only RetryableError is retried; a wait over MAX_RETRY_AFTER_MS or an abort
 * stops immediately. The last error is rethrown.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 2, baseDelayMs = 500, signal, onRetry } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof RetryableError) || attempt >= retries || signal?.aborted) throw error;
      const asked = error.retryAfterMs ?? 0;
      if (asked > MAX_RETRY_AFTER_MS) throw error;
      await onRetry?.(attempt + 1, error);
      await sleep(Math.max(baseDelayMs * 2 ** attempt, asked), signal);
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
