# Listing fixtures

Synthetic pages shaped like real provider output (Tavily markdown of LinkedIn guest pages and ATS pages, see [docs/spikes/extraction.md](../../docs/spikes/extraction.md)). Company names and text are invented; no third-party listing text is stored here.

| File | Shape |
| --- | --- |
| `linkedin-complete.md` | Guest job page: sign-in boilerplate, recruiter card, full description, criteria block, "Similar jobs" noise |
| `linkedin-expired.md` | Expired job id redirected to a jobs search page |
| `linkedin-login.md` | Sign-in page (localized) instead of a job |
| `linkedin-truncated.md` | Job card present but description cut short, no criteria block |
| `ats-complete.md` | Employer ATS posting for the same role as `linkedin-complete.md` |
| `ats-other-company.md` | Same title at a different company with a similar name |
