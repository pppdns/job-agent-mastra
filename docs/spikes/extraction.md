# Spike: listing extraction (M3, 2026-11-03)

Live run of [`apps/agent/scripts/spikes/extraction.ts`](../../apps/agent/scripts/spikes/extraction.ts) on 5 public LinkedIn job URLs (Budapest, UK, US roles; `/jobs/view/<id>` and `/jobs/view/<slug>-<id>` forms). Raw outputs were kept outside the repo.

## Results

| Provider | LinkedIn result | Latency | Cost |
| --- | --- | --- | --- |
| Tavily extract `basic` | 5/5 full descriptions | ≈0.6 s | 1 credit / 5 URLs |
| Tavily extract `advanced` | 5/5 full descriptions (same content) | 4–17 s | 2 credits / 5 URLs |
| Firecrawl scrape v2 | 0/5: HTTP 403 "we do not support this site" | — | — |

Tavily returns LinkedIn's public guest page as markdown: `# <title>`, `#### [<company>](…/company/…) <location> …`, the description, then a `* ### Seniority level` / `Employment type` / `Job function` / `Industries` block, then "Similar jobs" noise.

Failure shapes seen:

- Unknown job id → Tavily `failed_results` ("404 page not found").
- Expired job id → redirect to a jobs **search** page: no `# <title>` top card, no criteria block.
- Non-job LinkedIn page (`/feed/`) → pure sign-in page (localized, e.g. German "Einloggen").
- Every guest job page contains "Join or sign in" boilerplate, so **sign-in text alone does not mean a login wall**. Completeness is decided by the presence of the top card + criteria block + a description of reasonable length.

ATS lookup via Tavily search (`"<title>" "<company>" job`): found the exact Greenhouse posting for one role; for others returned the company's board root, social posts, aggregators, or **different companies with the same name** ("Tilt"). An ATS match is therefore only accepted after an identity check (title and company both present in the extracted page) and a completeness check. Greenhouse pages extract cleanly with Tavily `basic`.

## Decision

- **Tavily** for search and extraction everywhere. LinkedIn: `basic` first, `advanced` only if the result is incomplete.
- **Firecrawl** only as a second extractor for non-LinkedIn pages (company/ATS) when Tavily fails; its hosted browser stays optional for M6.
- No specialist LinkedIn provider (Apify etc.) needed for these samples. Revisit if failures show up in use.
- Pasted text is always accepted and stored as a `pasted` source.

## Residual gaps

- Providers fetch the URL themselves; we validate the requested URL and the provider-reported final URL, but cannot see intermediate redirects inside the provider. Our server never fetches listing URLs directly, so there is no SSRF path into our network.
- LinkedIn guest pages may change layout or start blocking; detection then degrades to "incomplete → ATS lookup → ask to paste", never to assessing a partial page.
