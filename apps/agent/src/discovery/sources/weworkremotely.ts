import { type PostingInput, postingInputSchema } from "@copilot/shared";
import { htmlToText, httpUrl, regionList, str } from "../text";
import { createFeedSource } from "./feed";
import type { HttpText } from "./http";
import { parseRss, rssDate } from "./rss";

// We Work Remotely's public RSS feeds, one per category (settings pick the categories). Items
// carry the full description, a region ("USA Only", "Anywhere in the World") and the type.
// Titles are "Company: Role". The job page on WWR is the posting URL (attribution).

const FEED_URL = "https://weworkremotely.com/categories/";

/** Category slugs as in the feed URLs (`/categories/<slug>.rss`). */
export const WWR_CATEGORY = /^[a-z0-9-]{1,80}$/;

export function parseWwrItem(raw: unknown): PostingInput | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, string | undefined>;
  const url = httpUrl(item.link) ?? httpUrl(item.guid);
  const slug = url?.match(/^https:\/\/weworkremotely\.com\/remote-jobs\/([\w-]{1,200})$/)?.[1];
  const full = str(item.title, 400);
  const split = full?.indexOf(": ") ?? -1;
  if (!url || !slug || !full || split < 1) return null;
  const region = str(item.region, 200);
  const country = str(item.country, 100);
  const parsed = postingInputSchema.safeParse({
    source: "weworkremotely",
    externalId: slug,
    url,
    applyUrl: null,
    title: full.slice(split + 2).trim(),
    company: full.slice(0, split).trim(),
    location: `Remote (${[region, country].filter(Boolean).join(", ") || "not stated"})`,
    remote: true,
    regions: regionList(region),
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    salaryText: null,
    seniority: null,
    employmentType: str(item.type, 100),
    postedAt: rssDate(item.pubDate),
    description: htmlToText(item.description ?? ""),
  });
  return parsed.success ? parsed.data : null;
}

export function createWwrSource(http: HttpText, pauseMs?: number) {
  return createFeedSource({
    pauseMs,
    id: "weworkremotely",
    parse: parseWwrItem,
    requests: ({ settings }) =>
      settings.sources.weworkremotely.categories
        .filter((slug) => WWR_CATEGORY.test(slug))
        .map((slug) => ({
          label: slug,
          load: async (signal) =>
            parseRss(await http(new URL(`${FEED_URL}${slug}.rss`), { signal })),
        })),
  });
}
