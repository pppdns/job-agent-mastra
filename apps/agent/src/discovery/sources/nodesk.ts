import { type PostingInput, postingInputSchema } from "@copilot/shared";
import { htmlToText, httpUrl, str } from "../text";
import { createFeedSource } from "./feed";
import type { HttpText } from "./http";
import { parseRss, rssDate } from "./rss";

// NoDesk's public RSS feeds, one per category (`/remote-jobs/<category>/index.xml`). Small feeds
// (about 10 items each) whose descriptions are only the opening of the listing, so triage sees
// less than on other boards. Titles are "Role at Company".

const FEED_URL = "https://nodesk.co/remote-jobs/";

export const NODESK_CATEGORY = /^[a-z0-9-]{1,80}$/;

export function parseNoDeskItem(raw: unknown): PostingInput | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, string | undefined>;
  const url = httpUrl(item.link) ?? httpUrl(item.guid);
  const slug = url?.match(/^https:\/\/nodesk\.co\/remote-jobs\/([\w-]{1,200})\/?$/)?.[1];
  const full = str(item.title, 400);
  const split = full?.lastIndexOf(" at ") ?? -1;
  if (!url || !slug || !full || split < 1) return null;
  const parsed = postingInputSchema.safeParse({
    source: "nodesk",
    externalId: slug,
    url,
    applyUrl: null,
    title: full.slice(0, split).trim(),
    company: full.slice(split + 4).trim(),
    location: "Remote",
    remote: true,
    regions: [],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    salaryText: null,
    seniority: null,
    employmentType: null,
    postedAt: rssDate(item.pubDate),
    description: htmlToText(item.description ?? ""),
  });
  return parsed.success ? parsed.data : null;
}

export function createNoDeskSource(http: HttpText, pauseMs?: number) {
  return createFeedSource({
    pauseMs,
    id: "nodesk",
    parse: parseNoDeskItem,
    requests: ({ settings }) =>
      settings.sources.nodesk.categories
        .filter((slug) => NODESK_CATEGORY.test(slug))
        .map((slug) => ({
          label: slug,
          load: async (signal) =>
            parseRss(await http(new URL(`${FEED_URL}${slug}/index.xml`), { signal })),
        })),
  });
}
