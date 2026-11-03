import { env } from "../env";
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
