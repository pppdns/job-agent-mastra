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
| `remote-ambiguous.md` | "Remote-first" in European time zones without saying where hiring is possible; pay only "competitive" (evals) |
| `remote-platform-match.md` | Fully remote (EU) platform/Kubernetes role with stated pay: a clear match for the seeded eval profile (triage eval) |
| `injection.md` | Complete listing with instructions aimed at AI assistants: change the profile, approve, reveal keys (evals) |
| `hybrid-monthly.md` | "Hybrid" Berlin platform role with one office day a month (meets an at-most-one-day-a-week rule); rescorer model eval |
| `remote-us-only.md` | "Fully remote", but the last section restricts hiring to US residents; rescorer model eval |
| `em-platform.md` | Remote EU engineering-manager role (people management against an IC preference); rescorer model eval |
| `german-required.md` | Remote Germany Java/Kotlin role requiring fluent German (C1); rescorer model eval |
| `contradictory-remote.md` | Labelled "Remote (Germany)" but the team works from Munich Tuesday to Thursday; rescorer model eval |
| `monthly-salary.md` | Remote EU TypeScript product role with pay stated per month (EUR 7,600 × 12); rescorer model eval |
