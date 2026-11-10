import { MAX_RETRY_AFTER_MS, RetryableError, retryAfterMs, withRetry } from "../../web/retry";
import { CooldownError, SourceError } from "../types";

// GET/POST JSON for discovery sources: fixed hosts, timeout, size cap, bounded retries.
// Errors name the host and status only, never headers or keys.

const TIMEOUT_MS = 60_000;
const MAX_BYTES = 20_000_000;

export type HttpJson = (
  url: URL,
  init?: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
) => Promise<unknown>;

/** Identifies us to free feeds (no contact details: this is a single-user app). */
const USER_AGENT = "job-copilot/1.0 (personal job search)";

export const httpJson: HttpJson = (url, init = {}) =>
  withCooldown(
    url,
    async () => {
      const text = await request(url, init, "application/json");
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new SourceError(`${url.hostname} sent invalid JSON`);
      }
    },
    init.signal,
  );

/** GET a text document (RSS feeds), with the same timeout, size cap and retries. */
export type HttpText = (url: URL, init?: { signal?: AbortSignal }) => Promise<string>;

export const httpText: HttpText = (url, init = {}) =>
  withCooldown(
    url,
    () => request(url, init, "application/rss+xml, application/xml;q=0.9, */*;q=0.5"),
    init.signal,
  );

/** A `Retry-After` longer than we retry for becomes a CooldownError: sources stop for this run. */
async function withCooldown<T>(url: URL, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await withRetry(fn, { signal, retries: 2, baseDelayMs: 1_000 });
  } catch (error) {
    if (error instanceof RetryableError && (error.retryAfterMs ?? 0) > MAX_RETRY_AFTER_MS) {
      const secs = Math.round((error.retryAfterMs ?? 0) / 1_000);
      throw new CooldownError(`${url.hostname} is rate limiting (asked to wait ${secs} s)`);
    }
    throw error;
  }
}

async function request(
  url: URL,
  init: Parameters<HttpJson>[1] = {},
  accept: string,
): Promise<string> {
  const timeout = AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        accept,
        "user-agent": USER_AGENT,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new RetryableError(`${url.hostname} could not be reached`);
  }
  if (response.status === 429 || response.status >= 500) {
    throw new RetryableError(
      `${url.hostname} failed with ${response.status}`,
      retryAfterMs(response.headers.get("retry-after")),
    );
  }
  if (!response.ok) throw new SourceError(`${url.hostname} answered ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new SourceError(`${url.hostname} sent too much data`);
  return text;
}
