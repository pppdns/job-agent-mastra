# Discovery source fixtures

Synthetic data shaped like each source's real output (field names and types from one small live
run, 2026-11-10). No real listings or third-party text. Served instead of the live sources when
`WEB_MODE=fixture` (e2e, evals).

- `himalayas-search.json`: one page of the Himalayas search API (`/jobs/api/search`): a remote job
  limited to Germany/Portugal with pay, a worldwide one, an intern role (screened out), one limited
  to India/Philippines (screened out), and an invalid item.
- `linkedin-items.json`: dataset items of `valig/linkedin-jobs-scraper`: the Founding Engineer job
  again (cross-board duplicate), a Budapest team lead with an Ashby apply URL, an account executive
  (screened out), and an invalid item.
- `weworkremotely.rss`, `nodesk.rss`: RSS feeds (dates as `{{days-ago:N}}`, filled in at load): a
  worldwide full-stack role, the Founding Engineer job again (merged), a Latin America-only role
  (screened out); NoDesk has a new site reliability role and the WWR full-stack role again (merged).
- `remoteok-api.json`: the API array (legal notice first): an AI engineer role with pay, a sales
  role with garbage pay (screened out), an invalid item.
- `remotive-jobs.json`: the Lanternfish role again (merged) and a junior role (screened out).
- `ycombinator-items.json`: rows of `nomad-agent/ycombinator-was-scraper`: a remote AI engineer
  role, an on-site San Francisco role (screened out), an invalid row. The other Apify boards return
  nothing offline; their parsers are tested with inline items (`boards.test.ts`).
