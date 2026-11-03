import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findWorkspaceRoot } from "@copilot/db";
import { z } from "zod";
import type { WebProviders } from "./providers";

const indexSchema = z.object({
  pages: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      keywords: z.array(z.string()),
      file: z.string(),
    }),
  ),
});

/**
 * Offline stand-in for Tavily (WEB_MODE=fixture): searches `fixtures/web/index.json` by
 * keyword and "extracts" the matching markdown files. Used by e2e and offline evals.
 */
export function createFixtureWebProviders(
  dir = join(findWorkspaceRoot(), "fixtures/web"),
): WebProviders {
  const { pages } = indexSchema.parse(JSON.parse(readFileSync(join(dir, "index.json"), "utf8")));
  return {
    async search(query, { maxResults }) {
      const words = query.toLowerCase().match(/[\p{L}\p{N}-]+/gu) ?? [];
      return pages
        .map((p) => ({ p, score: words.filter((w) => p.keywords.includes(w)).length }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults)
        .map(({ p }) => ({ url: p.url, title: p.title }));
    },
    async extract(url) {
      const page = pages.find((p) => p.url === url);
      return page
        ? { ok: true, text: readFileSync(join(dir, page.file), "utf8"), finalUrl: url }
        : { ok: false, error: "404 page not found" };
    },
    scrape: null,
  };
}
