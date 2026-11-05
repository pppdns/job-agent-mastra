import { env } from "../env";
import type { Resolver } from "../ingest/url-guard";
import { createFixtureWebProviders } from "./fixture-providers";
import { createWebProviders, type WebProviders } from "./providers";

let cached: WebProviders | null | undefined;

/** The configured web providers: Tavily/Firecrawl, fixtures (WEB_MODE=fixture), or null. */
export function webProviders(): WebProviders | null {
  if (cached === undefined) {
    cached =
      env.WEB_MODE === "fixture"
        ? createFixtureWebProviders()
        : createWebProviders({ tavily: env.TAVILY_API_KEY, firecrawl: env.FIRECRAWL_API_KEY });
  }
  return cached;
}

/**
 * DNS for the URL guard. In fixture mode every host resolves to a public address without a
 * lookup (fixture providers only serve their own pages, so nothing leaves the machine); every
 * other guard check still applies. Live mode uses real DNS.
 */
export function webResolver(): Resolver | undefined {
  if (env.WEB_MODE !== "fixture") return undefined;
  return async () => ["93.184.216.34"];
}
