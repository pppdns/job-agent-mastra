# Listing ingestion

`ingest_listing` (`src/mastra/tools/ingest-listing.ts`) → `ingest.ts`. Provider choice and failure shapes: [docs/spikes/extraction.md](../../../../docs/spikes/extraction.md).

```mermaid
flowchart TD
  U[URL] --> G{url-guard}
  G -- private/unsafe --> B[blocked]
  G --> D{findJobByUrl}
  D -- saved, no refresh --> AS[already_saved<br/>job summary, nothing fetched]
  D -- otherwise --> L{LinkedIn?}
  L -- yes --> T1[Tavily basic → advanced<br/>parseLinkedInPage]
  T1 -- complete --> S[(save job + source)]
  T1 -- job card only --> A[Tavily search on ATS domains<br/>complete + matchesIdentity]
  A -- match --> S
  A -- none --> P[needs_paste + partial identity]
  T1 -- sign-in/search page --> P
  L -- no --> W[Tavily basic → Firecrawl<br/>parseGenericPage]
  W -- complete --> S
  W -- otherwise --> P
  X[Pasted text<br/>read from latest user message] --> S
```

- `url-guard.ts`: http(s), default ports, no credentials or local hostnames, every DNS answer public. Re-run on the provider's final URL. Our server never fetches listing URLs itself.
- Posting dates ("3 weeks ago" on the LinkedIn job card, "Date posted: …" on employer pages) are parsed by `listingPostedDate` in `@copilot/shared` when `@copilot/db` stores a source, not here; `listing.ts` reuses its `RELATIVE_AGE` to strip the age from the location.
- `listing.ts`: pure parsing. "Join or sign in" text appears on every LinkedIn guest page, so completeness means job card + criteria block + ≥ 80-word description, never "no sign-in text".
- Before any provider call, `ingestUrl` looks the URL up (`findJobByUrl`: LinkedIn id, canonical URL, or a `linkedin`/`ats` snapshot URL, so the employer posting found via LinkedIn counts; research `web` pages never do; URLs compare without tracking parameters, and ATS snapshots are stored that way). A hit returns `already_saved` with status, assessment version, verdict and `profileStale`; `refresh: true` (user asked to re-read) skips the check. Misses the same job under a different URL (LinkedIn vs. employer site, `www`/scheme/slash variants); those still dedupe on save only if `upsertJob` matches. Pasted text isn't checked up front.
- Only complete listings are saved from URLs; pasted text is always saved (flagged `complete: false` under 150 words). Jobs dedupe in `@copilot/db` (`upsertJob`); sources are idempotent per job + content.
- Tool output carries `notice` (untrusted text). Provider errors expose status codes only.
- Tests use fake providers and `fixtures/listings/` (synthetic). Live checks: [docs/verification.md](../../../../docs/verification.md).
