# Lessons learned

What building the Job Research Copilot (M1–M18, 2026-11-03 to 2026-11-10) taught us, and the Mastra-specific decisions behind it. Evidence lives in [verification.md](verification.md), decisions in [PLAN.md](PLAN.md), mechanics in [architecture.md](architecture.md). Each lesson names where it showed up.

## Mastra: what worked, and the decisions it forced

- **A separate Mastra server next to Next.js paid off.** Runs outlive web requests; Studio and `mastra api` became the main verification loop (traces checked one-to-one against the usage panel in M8). The cost is one proxy layer, and the shared secret, ownership checks and stream sanitizing all live in it.
- **Use the native AI Gateway provider, not the `vercel/` router string.** The router goes through Gateway's OpenAI-compatible endpoint and can drop cache and reasoning usage. The native `@ai-sdk/gateway` instance reports cache read/write and thinking tokens (M1).
- **Durable agents work for refresh/reconnect, but you build the routes.** `chatRoute()` has no durable or observe support. We wrote `POST /chat` (durable stream) and `GET /chat/:threadId/stream` (`observe`) ourselves, plus a Stop endpoint, because closing the HTTP connection doesn't stop a durable run. The replay cache is in-process, so a server restart loses it, which we accepted (plan simplification 1). Durable runs can also store one turn as several assistant messages, so history merges them ([durable-resume spike](spikes/durable-resume.md), M7).
- **Sanitize the stream before AI SDK UI sees it.** A 5.7k-character tool call with invalid JSON made Mastra's v7 stream emit `tool-input-available` without `input`, and `useChat` rejected the whole turn. A chunk sanitizer in the `/chat` route plus `maxOutputTokens` fixed it (M6).
- **Keep durable state in app tables, not memory.** The approved profile is versioned app data injected each turn. Thread working memory holds only chat-local assumptions. Observational Memory compacts the transcript. Things that must survive compaction (the approved profile, pending approvals) are injected from the database, never recalled from a summary. Two bugs proved the point:
  - The Observer copied the approved profile into its observations (M7).
  - Chat A's local exception leaked into a shared draft (M5).
- **Scheduled workflows are native but need guarding.** `createWorkflow({ schedule })` keeps its state in libSQL, and every worktree copies `.env` and the database. So the schedule is declared only on the production image or the main checkout's dev server, and a copied schedule row is deleted at boot elsewhere. Otherwise N checkouts would mean N runs, N bills and N emails (M13, M17).
- **Pick one owner for interrupted runs.** The production server restarts active workflow runs at boot (`restartAllActiveWorkflowRuns`), while our startup marked them interrupted. After a deploy, discovery runs kept going unseen, never finished, and a second run started beside one. `autoRestartActiveRuns: false` leaves recovery to the next run (M18).
- **Mastra builds have surprises in production.** `mastra build` writes its own `pnpm-workspace.yaml` into `.mastra/output`, so the agent couldn't find its migrations from there; it now starts from the repo root (Fly deploy). Durable agents don't emit the thread-title chunk, so the UI refreshes the sidebar itself (M7).
- **Observability without another platform.** Mastra traces, logs and metrics in DuckDB were enough. Studio covers browsing, `app_run_events` per-call usage, and Sentry (added last) production errors. No Langfuse needed, as the brief asked.

## Agent behaviour: rules belong in code

- **Enforce in code what the prompt asks for.** Prompt rules alone kept slipping across eval runs: weak claims stated as fact, fit points labelled as official evidence. `saveDraft` now rejects drafts that break the rules, for example a fit point that isn't `inference` or that cites unknown profile facts. The model gets the error and retries (M9). The same goes for approvals, status changes the user didn't ask for, budgets and URL checks: deterministic code decides.
- **Attribute at the source.** "Weak claims stay attributed in the reply" still failed 2 of 5 runs, because the slip moved into draft fields. It held 5/5 once the researcher wrote weak claims as "one anonymous review says …" and the copilot rules named every draft field (M9).
- **Shared rules, one copy.** A rule that existed only in the copilot prompt was missing from the batch re-scorer, so the rescorer judged remote-first as meeting the remote rule without the Germany condition. The assessment rules now live in one shared block (M9).
- **Tell the model today's date.** Without it, the researcher misdated sources ("a June 2025 post is five months old") (M9).
- **Budgets need feedback, not just a ceiling.** A research run hit its tool-call cap with no claims recorded. The researcher now sees how many calls remain and records after each page (M7).
- **Retry schema rejections once, with the reason.** Over-long headlines or reasons failed whole jobs until the assessor and triager got one retry with the rejection message, or had the text cut instead (M9, M14).

## Evals: what they're good for

- **Separate deterministic gates from judges.** Code checks decide authorization, state transitions, idempotency and provenance. LLM judges score groundedness and usefulness, and their scores are evidence, not truth. Several first-run "failures" were eval bugs, not agent bugs:
  - Fixtures were under the minimum length.
  - A leak regex was too broad.
  - The judge mistook working-memory instructions for profile data.
- **Repeat flaky cases before trusting a fix.** `EVAL_REPEAT` exposed behaviours that passed once and failed 2 of 6 runs. Fixes were accepted only after 5/5 repeats and a full run (M9).
- **Mirror live scenarios offline.** Multi-chat memory, compaction and stale comparisons run live in `scenarios.eval.ts` (judge included), and their mechanics run offline in Vitest (`memory.test.ts`, `compaction.test.ts`, `saved-jobs-stale.test.ts`). The offline tests catch regressions for free, and the live ones catch behaviour.

## Job discovery: data from boards

- **Most "bad results" were our filters, not the boards.**
  - LinkedIn's first run asked for a month of postings and the screen dropped them as old.
  - A ~130-country EMEA list was cut at the region cap and falsely rejected; long lists now count as unrestricted.
  - "California" didn't count as US.
  - Each was found by one small live run with counts per screen reason, then fixed and unit-tested (M13, M16).
- **Read provider costs defensively.** Apify cost was undercounted twice: first we read the wrong event name, then `usageTotalUsd` turned out to lag right after a run finishes ($0.001, then $0.401 twenty seconds later). Cost is now the larger of reported usage and the final charged events × prices, so the monthly budget check can't see too little spend (M13, M18).
- **Cheap screening first, the model last.** The deterministic screen, then a fast-model triage (~$0.0004 per job), then full assessments for only the top matches kept a run of ~500 new LinkedIn postings at about $1.20 all in: Apify $0.17, 400 triage calls $0.17, 14 assessments $0.85 (M14). Prompt caching never kicked in for triage (no cache hits), which is still open savings.
- **Dedupe needs stable identities.** Company key + normalized title catches reposts across boards. An ATS key read from any URL form (`greenhouse:acme:123`) catches the same job under different links. A feed listing one role per office needs collapsing, keeping the copy the screen passes (M13, M18).
- **Keep what you need to debug later.** Every posting is stored with its screen reasons, and since M18 raw items that failed parsing plus a small sample, with the Apify run ids. Parsers can be replayed against real output after a board changes its fields.
- **Choose sources on measured yield.** Each board's 30-day matches, matches no other board found, overlap and cost per match are shown on `/discovery`. Dice was turned off and Welcome to the Jungle skipped on that kind of evidence; the career-sites feed was picked over a hand-built ATS resolver because the resolver finds no new jobs (M16, M18).

## Process

- **Only claim live what ran live.** The verification log keeps offline and live results apart. Many real bugs showed up only live:
  - The Gateway free tier refused Sonnet.
  - An inactive Apify key.
  - The schedule that could never be on in production.
  - The startup path inside the image.
- **Small verified commits, one PR per piece.** Checks on every commit (`pnpm check` in the pre-commit hook) and a short PR per change made parallel sessions workable. The merge conflicts that did occur were append-only doc sections and migration numbers.
- **Share the machine.** Several agents ran e2e and evals at once. `wait-for-idle.sh` queues heavy runs. Most e2e flakes were real races that load made visible: a menu opened on rows a tab change was about to replace, a click landing before hydration. They were fixed in the tests (waiting for the new state), not with longer timeouts.
- **Ask about tradeoffs early.** The plan's "simplifications chosen" list (in-process replay, FTS instead of embeddings, estimated external cost) kept the build small. Each one was a deliberate choice the user could veto, and none has blocked a milestone so far.
