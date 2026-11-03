import { z } from "zod";

// Thin, schema-validated clients for Tavily and Firecrawl (docs/spikes/extraction.md).
// Errors carry status codes only: never request bodies, headers or keys.

export const PROVIDER_TIMEOUT_MS = 30_000;
const MAX_PAGE_CHARS = 200_000;

export type PageResult =
  | { ok: true; text: string; finalUrl?: string }
  | { ok: false; error: string };

export type SearchHit = { url: string; title: string };

export interface WebProviders {
  /** Tavily extract. */
  extract(url: string, depth: "basic" | "advanced", signal?: AbortSignal): Promise<PageResult>;
  /** Firecrawl scrape (does not support LinkedIn). Null when not configured. */
  scrape: ((url: string, signal?: AbortSignal) => Promise<PageResult>) | null;
  /** Tavily search. */
  search(
    query: string,
    options: { maxResults: number; includeDomains?: string[] },
    signal?: AbortSignal,
  ): Promise<SearchHit[]>;
}

const tavilyExtractSchema = z.object({
  results: z.array(z.object({ url: z.string(), raw_content: z.string().nullish() })).default([]),
  failed_results: z.array(z.object({ error: z.string().nullish() })).default([]),
});

const tavilySearchSchema = z.object({
  results: z.array(z.object({ url: z.string(), title: z.string().nullish() })).default([]),
});

const firecrawlScrapeSchema = z.object({
  success: z.boolean().optional(),
  data: z
    .object({
      markdown: z.string().nullish(),
      metadata: z.object({ url: z.string().nullish() }).partial().nullish(),
    })
    .nullish(),
  error: z.string().nullish(),
});

async function postJson(
  url: string,
  key: string,
  body: unknown,
  signal: AbortSignal | undefined,
  name: string,
): Promise<{ status: number; json: unknown }> {
  const timeout = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok && response.status >= 500)
    throw new Error(`${name} failed with ${response.status}`);
  return { status: response.status, json };
}

const bounded = (text: string) => text.slice(0, MAX_PAGE_CHARS);

export function createWebProviders(keys: {
  tavily?: string;
  firecrawl?: string;
}): WebProviders | null {
  const tavilyKey = keys.tavily;
  if (!tavilyKey) return null;
  const firecrawlKey = keys.firecrawl;

  return {
    async extract(url, depth, signal) {
      const { status, json } = await postJson(
        "https://api.tavily.com/extract",
        tavilyKey,
        { urls: url, extract_depth: depth, format: "markdown" },
        signal,
        "tavily extract",
      );
      if (status !== 200) return { ok: false, error: `tavily extract returned ${status}` };
      const body = tavilyExtractSchema.parse(json);
      const result = body.results[0];
      if (!result?.raw_content) {
        return { ok: false, error: body.failed_results[0]?.error ?? "no content returned" };
      }
      return { ok: true, text: bounded(result.raw_content), finalUrl: result.url };
    },

    scrape: firecrawlKey
      ? async (url, signal) => {
          const { status, json } = await postJson(
            "https://api.firecrawl.dev/v2/scrape",
            firecrawlKey,
            { url, formats: ["markdown"], onlyMainContent: true, timeout: PROVIDER_TIMEOUT_MS },
            signal,
            "firecrawl scrape",
          );
          const body = firecrawlScrapeSchema.parse(json ?? {});
          if (status !== 200 || !body.data?.markdown) {
            return { ok: false, error: `firecrawl scrape returned ${status}` };
          }
          return {
            ok: true,
            text: bounded(body.data.markdown),
            finalUrl: body.data.metadata?.url ?? undefined,
          };
        }
      : null,

    async search(query, { maxResults, includeDomains }, signal) {
      const { status, json } = await postJson(
        "https://api.tavily.com/search",
        tavilyKey,
        { query, max_results: maxResults, search_depth: "basic", include_domains: includeDomains },
        signal,
        "tavily search",
      );
      if (status !== 200) throw new Error(`tavily search returned ${status}`);
      return tavilySearchSchema
        .parse(json)
        .results.map((r) => ({ url: r.url, title: r.title ?? "" }));
    },
  };
}
