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
