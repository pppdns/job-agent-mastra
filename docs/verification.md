# Verification log

Offline (mock/fixture) results and live results are kept separate. A live integration is only listed here after it was actually exercised.

## Live checks

| Date | Milestone | What | Result |
| --- | --- | --- | --- |
| 2026-11-03 | M1 | Browser → Next `/api/chat` → Mastra `/chat` → AI Gateway `anthropic/claude-sonnet-5.5`, streamed | ✅ Reply streamed; trace `success`, provider `gateway`, TTFT ≈ 2.0 s |
| 2026-11-03 | M1 | `pnpm agent:api agent run copilot` (live) | ✅ Usage includes cache read/write, 5m/1h cache creation, thinking tokens (native provider, not `vercel/` router string) |
| 2026-11-03 | M2 | Chat titles via `generateTitle` with `anthropic/claude-haiku-5.5` | ✅ Real titles in the sidebar (e.g. "Flex Budapest Embedded Tec…") |
| 2026-11-03 | M3 | Extraction spike, 5 LinkedIn URLs: Tavily `basic`/`advanced`, Firecrawl v2 scrape | ✅ Tavily 5/5 full listings (`basic` ≈0.6 s); ❌ Firecrawl 403 "site not supported" |
| 2026-11-03 | M3 | `agent run copilot` with a LinkedIn URL (Sonnet 5.5 + Tavily) | ✅ `ingest_listing` saved job + `linkedin` source with thread id; reply named the source and listed unknowns (≈4.2k in / 0.9k out tokens) |
| 2026-11-03 | M3 | Expired LinkedIn job id | ✅ Both depths returned a search page → `needs_paste`; agent asked for the text, nothing saved |
| 2026-11-03 | M3 | Pasted listing text | ✅ Tool read the latest user message (`fromLatestUserMessage`), saved a `pasted` source |
| 2026-11-03 | M3 | ATS fallback (LinkedIn page cut to the job card, real Tavily search/extract) | ✅ Matched Dwelly's Greenhouse posting via identity check, saved as `ats` source |
| 2026-11-03 | M3 | Web UI with a LinkedIn URL | ✅ `basic` came back incomplete, `advanced` complete; Trace row "Read the LinkedIn listing"; Markdown rendered |
| 2026-11-03 | M3 | Link-local metadata URL in chat | ⚠️ Model declined to call the tool, so the guard was not reached live (guard covered by unit + e2e tests) |
| 2026-11-03 | M4 | Web UI: LinkedIn URL (Dwelly Applied AI Engineer) | ✅ Listing read, qualified role-only assessment in chat, `save_job_draft` v1 with sourced and inference points, three research directions offered (≈22 s turn) |
| 2026-11-03 | M4 | "Save this as the final snapshot" → approve in the card | ✅ `propose_job_snapshot` created a pending approval; agent said it is not saved until approved; Approve → "Approved · v1"; `/jobs` and job page show approved v1 and draft v1 (≈3 s turn) |
| 2026-11-03 | M5 | "Remember that I only want fully remote roles, and that I prefer small teams." | ✅ `propose_profile_change` with one hard requirement + one soft preference; nothing applied until approved in the chat card → profile v1 |
| 2026-11-03 | M5 | "For this chat, also include London hybrid roles" | ✅ Written to thread working memory as a local exception; profile unchanged |
| 2026-11-03 | M5 | Hypothetical ("if I were open to relocating to Budapest…") | ✅ No profile proposal; answered against approved profile + local note (≈41k in tokens incl. re-reading the listing) |
| 2026-11-03 | M5 | New chat: "Compare the Dwelly role I saved with the Flex job" | ✅ `find_saved_jobs` + `get_job` for both; criteria table against the approved profile; flagged the Dwelly assessment as predating the profile and re-drafted it. ⚠️ Found chat A's local exception inside a shared draft (did not rely on it) → instructions fixed |
| 2026-11-03 | M5 | Re-check after the fix: chat-only "Budapest office roles acceptable", then reassess Flex | ✅ Exception applied in the reply only; new draft v2 written against the approved profile without it |
| 2026-11-03 | M6 | Research run 1 (Dwelly Applied AI Engineer chat, business health + engineering) | ⚠️ Research finished (4 claims, 6 pages, publication dates kept) but the turn died: Sonnet's follow-up `save_job_draft` arguments (5.7k chars) were not valid JSON and Mastra's v7 stream sent `tool-input-available` without `input`, which `useChat` rejects → custom `/chat` route with chunk sanitizer + `maxOutputTokens` 16k |
| 2026-11-03 | M6 | Research run 2 (new chat, Dwelly AI Engineering Team Lead: engineering + stability) | ✅ `find_saved_jobs` → `get_job` → `research_company`: 3 searches, 5 pages, 5 claims (listing/official, independent, unknown/conflicting) with links and publication dates; 8 web calls, 39 s, est. $0.20; reply flagged London vs remote-only and listed unknowns; draft saved |
| 2026-11-03 | M7 | Reload during a live research run (Dwelly, foreground Chrome via Playwright) | ✅ After the reload the user message was back and the resumed run finished in view; history afterwards showed one reply (after merging the two assistant rows Mastra stored for that turn) |
| 2026-11-03 | M7 | Stop during a live research run (Dwelly) | ✅ 2 claims stored at 17 s → Stop → run `cancelled`; no new claims 25 s later; reload shows the partial timeline and findings |
| 2026-11-03 | M7 | Live research hitting the tool-call budget (Flex) | ⚠️ Stopped cleanly at 12 calls but had recorded no claims; the reply said so and kept the old draft → researcher now sees remaining calls and records after each page (re-check above recorded early) |
| 2026-11-03 | M7 | Observational Memory with Haiku 5.5 at `OM_MESSAGE_TOKENS=1000` (agent:api, 6 turns) | ✅ Observer output parsed (buffered, then activated); pending tokens fell after activation; the agent still recalled a codename from turn 1. The Observer had copied the approved profile → told not to (instruction change not re-run live) |
| 2026-11-03 | M7 | Built-in browser pane (hidden) after reload | ⚠️ Chat stayed on its loading fallback; same page in foreground Chrome rendered fine (background-tab scheduling, not an app bug) |
| 2026-11-03 | M8 | Research turn (Dwelly engineering) vs Studio trace `35d3d6…` | ✅ Researcher 9 steps 144,739/3,520 and observer 17,618/1,370 equal in panel and trace; copilot agent steps equal. ⚠️ Title generation (1,541/26) missing from the panel → metered, re-checked below. Panel: 4 searches, 6 extractions, est. $0.53 total |
| 2026-11-03 | M8 | New-chat turn vs Studio trace `f088e7…` | ✅ All 7 model calls (5 copilot, observer, title) match one-to-one with equal input/output tokens; no extra or missing rows |
| 2026-11-03 | M8 | Prompt caching | ⚠️ Every model call reports 0 cached input tokens: caching isn't enabled, so each step pays full input (6k–30k tokens) |
| 2026-11-03 | UI | Reassess saved Flex job against the profile (new chat, foreground Chrome) | ✅ Draft v4 had a headline and `fitLevel` weak; chat showed the assessment card (verdict, 2/5 fit meter, signal chips, top points). ⚠️ Reply after the card was ~140 words, longer than the 2–4 sentences asked for |
| 2026-11-03 | M8 | DuckDB observability store: web chat turn → Studio APIs | ✅ Trace `7ae6ae…` (the panel's link) has 17 spans incl. nested title generation; `log list` returns runtime logs; `metric breakdown` gives tokens and est. cost per model; `mastra dev` hot restart reopens the DuckDB file without a lock error; e2e 16/16 with its own `e2e.duckdb`. ⚠️ Traces from before the switch stay in libSQL and their Studio links show nothing |
| 2026-11-03 | Ops | `pnpm ngrok` next to `pnpm dev` | ✅ Tunnel to :3000 only; a request without the login gets 401 |
| 2026-11-03 | M1 | Gateway free tier → Sonnet 5.5 | ❌ 403 `RestrictedModelsError` (resolved by funding the account). Client received only the sanitized summary; full error stayed in server log and trace |
| 2026-11-03 | M9 | `pnpm eval`: 12 copilot cases, Sonnet 5.5 agent + `openai/gpt-6.1-sol` judges, web fixtures, `data/eval.db` | ✅ Pipeline works; scores persisted with trace ids. Final run 13/14 checks passed; 1 real finding (see Evals) |
| 2026-11-04 | M9 | `scenarios.eval.ts` (`EVAL_ONLY=scenario pnpm eval`): memory across chats, compaction at a 1.5k-token OM threshold, comparison of stale assessments; Sonnet 5.5 + `openai/gpt-6.1-sol` judge, fixtures | ✅ 9/9 checks (code + judge), ≈3 min. First run failed 2 code checks that were too broad (listing text matched the leak regex); behaviour was correct |

## Offline checks (M1)

- `pnpm check`: Biome, typecheck, 9 agent + 3 db unit tests.
- `pnpm e2e` (mock model, isolated stack): streamed reply through proxy; agent rejects requests without the shared secret (401).

## Offline checks (M2)

- `pnpm check`: agent unit tests add chat memory (same-thread recall, no cross-thread leak, foreign resource rejected, history route scoped) and the durable resume spike; web unit tests cover the `/api/chat` request schema and agent body.
- `pnpm e2e` (7 tests): separate chat histories, reopen after reload, rename and delete, a thread inserted for another resource is absent from listings (even with `?resourceId=`), 403 on read/rename/delete, 404 on history, and a send from the UI fails with the sanitized error. New and existing routes return 401 without the secret.

## Offline checks (M3)

- `pnpm check`: URL guard (36 cases incl. DNS answers in private ranges, IPv4-mapped loopback), LinkedIn/generic parsing on synthetic fixtures, dedupe and idempotent sources on a real libSQL file, orchestrator paths with fake providers (complete, advanced retry, sign-in, expired, ATS match vs same-title other company, no match, blocked, private redirect, Firecrawl fallback, no provider), mock tool calls.
- `pnpm e2e` (10 tests): adds unreadable URL → "Couldn't read the full listing", private URL → "Didn't open the link", pasted text saved with the chat id as provenance and the Trace row surviving reload.

## Offline checks (M4)

- `pnpm check`: assessment schema; db state machine (versions, foreign/unsourced evidence rejected, idempotent proposals, supersede, approve → v1, retry returns same snapshot, concurrent approvals → one snapshot, wrong chat, changed hash, newer draft → stale, reject then approve refused, v1 kept when v2 approved).
- `pnpm e2e` (11 tests): adds paste → draft → propose → approve with the mock model; jobs list shows "Awaiting approval" before and "Approved v1" after; status survives reload; another chat gets 404 for the approval.

## Offline checks (M5)

- `pnpm check`: profile changes (approve applies a new version, modify supersedes with history, remove, unknown fact ids rejected, stale when the base version moved, idempotent per chat, wrong chat, reject leaves profile), drafts record profile version and staleness, FTS search (prefix, overview text, injection-shaped input); thread working memory isolation; profile prompt formatting.
- `pnpm e2e` (12 tests): adds remember → card → approve; "Profile?" in a new chat shows the approved fact; "Local?" shows the note only in its own chat; jobs list flags the earlier draft; profile page add → pending → approve → history.

## Offline checks (M6)

- `pnpm check`: budget (tool-call limit, spend refused before the call, LLM spend abort, time, parent cancel incl. already-aborted signal), claims (dates, sourced-class rule, foreign sources), `runResearch` with mock model + fixture pages (completed with progress order, budget exhausted after one search with no claims, cancelled, unavailable), `/chat` chunk sanitizer.
- `pnpm e2e` (13 tests): adds a research run in the UI (timeline lines, findings with evidence badge, source link, labelled estimate; timeline after reload; job page evidence).
- Not exercised live: a budget-limited or cancelled run (offline only).

## Offline checks (M7)

- `pnpm check`: runs (active run, first final status wins, interrupted at startup), forced-low-threshold compaction (old raw message gone, observations present, approved profile and pending approval id still in the prompt), retries (bounded, only retryable errors, abort), research retry progress, history merge.
- `pnpm e2e` (16 tests): adds reconnect after refresh mid-reply, Stop → `cancelled` with the reply cut short after reload, 409 for a second message while running. One flaky failure seen once under parallel load (profile flow timeout); two re-runs green, timeout raised to 60 s.

## Offline checks (M8)

- `pnpm check`: run totals (sums per row, groups by category), recorder (chunk sequence, buffering before the run id, metered search/extract incl. a failure, cost arithmetic incl. cache reads), prices, sanitizer (redaction, page text omitted, bounds), trace redaction (auth headers, cookies, API keys, `access_token` in JSON strings), metered model (generate + stream).
- `pnpm e2e` (16 tests): research run then panel shows one search, one extraction, copilot and researcher model calls, the tool row, the estimate label, and chat totals.

## Offline checks (visual assessment UI)

- `pnpm check`: assessment summary (headline fallback to the overview's first sentence, fit level hidden for role-only), `saveDraft` fit-level rule (only with `with_profile`, required there).
- `pnpm e2e` (16 tests): the saved draft renders as a card with headline, verdict, fit state and signal counts (also after reload); approval card and jobs row show the verdict and headline.

## Batch re-score and approve all

- `pnpm check`: `latestListingSource` skips research pages; `saveDraft` rejects a draft made against an older profile version; `approveDrafts` (approved / changed / not_found, retry approves nothing twice); `runRescore` with the mock model (only stale jobs, one draft each, profile no longer stale, missing listing fails without stopping the batch, stopped run saves nothing).
- `pnpm e2e` (18 tests): adds paste → profile change on `/profile` → "Profile changed" → Re-score button → batch in a new chat (progress, results list) → Approve all → jobs row "Approved v1", no longer stale. Runs in its own Playwright project after the other specs.
- Live (2026-11-03): `runRescore` on a throwaway database with the synthetic `ats-complete.md` listing and a new "fully remote within the EU" hard requirement. Sonnet 5.5 via AI Gateway returned a valid structured assessment in ~15 s: verdict pass, fit poor, hard conflict "3 office days in Lisbon" citing the listing source. Not exercised live: the button and chat flow end to end, batches of several jobs, token cost per job.

## Evals (M9)

Live models, offline web (fixtures). Judge scores are evidence, not truth. Details: [apps/agent/src/evals/AGENTS.md](../apps/agent/src/evals/AGENTS.md).

- Run 1 found eval bugs, fixed before run 2: both new fixtures were under the 150-word minimum (flagged incomplete); `draft-after-listing` fired on incomplete pasted text; the judge saw Mastra's working-memory instructions as "profile" data and penalized saved drafts as unapproved. Working-memory notes during assessments (current job, open questions) were allowed after reading them.
- Strengths and weaknesses may now be personal (your choice): the "role strengths vs personal fit" case became **fit with an unresolved requirement** (fit conclusions marked inference; no confirmed fit while hiring from Germany is unknown), with a matching copilot prompt line.
- Then (your choice) fit that hinges on an unknown is stated conditionally ("fits your remote rule if they can employ you in Germany"), and points comparing the job with the profile are labelled inference even when they quote the listing.
- Latest run (2026-11-03): **14/14 gates pass**; quality averages ≥ 0.8. Still flaky across runs: research reply stating an anonymously reported reorg as fact (failed 2 of 6). Judge notes worth a look: the research reply misjudged a June 2025 blog post as five months old (the copilot may not know today's date); "moderate on-call" asserted from rotation frequency alone; the hypothetical reply implies a London conflict with an empty profile (quality 0.25).
- Per case ~4–60 s; whole run ≈ 3 min. Token cost per run not measured yet (visible per trace in `pnpm eval:studio`).
- Not covered yet: multi-chat memory, compaction, stale comparisons; live scoring on real chats was wired but not yet observed on a live dev turn.
- Today's date in both agents' instructions (2026-11-03 run): the research reply now dates sources correctly ("June 2025 … over 16 months old", Series B "March 2026"). That run: 12/14. Failures: research reply again calls the anonymously reported reorg fact ("what the reorg changed"; now 3 of 7 runs); truncated listing tripped `check-no-tool-errors` on a self-corrected `save_job_draft` schema error (invalid evidence value, retried successfully).
- Reorg-as-fact fix: the copilot rule alone ("weak claims stay attributed in reply, unknowns, questions") left 2 of 5 runs failing (the slip moved into draft fields: "post-reorg stability"). Adding attribution at the source (the researcher writes weak claims as "one anonymous review says …") plus naming every draft field and banning labels like "post-reorg": 5/5 in `EVAL_ONLY=research EVAL_REPEAT=5`, then 2/2 full runs.
- Self-corrected `save_job_draft` schema slips (evidence `"listing"`, headline > 140 chars) addressed in the shared assessment rules (copilot + rescorer). Sign-in case now allows working-memory notes, like the assessment cases.
- Final run (2026-11-03): 13/14. Fails: fit with an unresolved requirement, one personal-fit point labelled `official` instead of inference (fails 2 of the last 4 runs). Recurring quality-judge nits: "moderate on-call" and "fairly paid" asserted without evidence; hypothetical reply implies an existing location restriction.
- Fit labels enforced in code: assessment points carry `profileFactIds`; `saveDraft` rejects a fit point that isn't `inference`, cites unknown facts, appears in a `role_only` draft, or a `with_profile` draft without any. The model gets the error and retries (copilot) or the job fails (rescorer, structured output; mock rescorer updated). Fit case: rubric 5/5 (`EVAL_REPEAT=4` + full run); 2 of 4 repeats first sent `fact:<id>`, rejected and retried, now normalized in `saveDraft`. Full run (2026-11-03): **14/14**. `pnpm e2e`: 18/18. Live rescorer (`rescore.eval.ts`, 3 fixture jobs, Sonnet 5.5): 9/9 jobs saved valid `with_profile` drafts over 3 runs, all fit points inference, fit levels poor / weak / good as expected. Gap: the rescorer marks remote-first as satisfying the remote rule without the Germany condition (the conditional-fit rule is only in the copilot prompt).
- Conditional-fit rule moved from the copilot prompt into the shared assessment rules (copilot + rescorer); the rescorer's leftover "keep the role separate from personal fit" line removed; the rules split into one bullet each. Rescorer now retries once with the rejection message when `saveDraft` refuses its draft (before: the job failed; seen once on Brightfield). `rescore.eval.ts` adds a keyword check that the Lumen draft names Germany as an unknown and never says the remote rule is met without a condition. Results: before the split 1–2 of 5 runs conditional; after it 3 of 4; every job saved in all 7 runs. Copilot suite 14/14 after the move.

## Job tracking + early preference questions (M10)

- Offline: db tests (status transitions, archive on rejected/dismissed, unarchive, no-op repeat, re-upsert keeps status, re-score skips archived), tool tests (`set_job_status`, `find_saved_jobs` by status/archived), list helper tests; `pnpm e2e` 19/19 incl. `jobs.spec.ts` (search, status menu, tabs, archive, unarchive, job page).
- Browser (worktree DB copy): table, tabs with counts, search, dismiss → Archived → reopen, row click opens the job, status menu on the job page.
- Live (2026-11-03, Sonnet 5.5): "I applied to the Esko Manager Agentic AI job…" → `find_saved_jobs` → `set_job_status applied`; the job then showed under the Applied tab.
- `set_job_status` guard, live: asking it to load the listing (`get_job` with `includeListing`) and then set a status → refused by app code; "I got an interview … mark it as interviewing" → changed.
- Live eval: `complete listing, role only` (empty profile, rubric now requires 1–2 deciding preference questions and forbids more) 2/2; `prompt injection in listing` (fixture also asks to mark the job applied; `set_job_status` forbidden) 2/2. The full suite was not re-run.

## No approval for assessments; direct profile edits (M12)

- Offline: `pnpm check` (db: assessment history read model, `editProfile` applies at once, refuses a stale base version, makes an older chat proposal stale; compaction test now keeps a pending profile change). `pnpm e2e` 19/19 incl. new `assessments.spec.ts` (v1 → v2, history toggle, no approve controls) and the cross-chat approval 404 check moved into `profile.spec.ts`.
- Migration `0010` on a copy of the dev DB: 23 snapshot approvals and 20 snapshots dropped; 8 profile versions, their approvals and 37 assessment versions kept.
- Browser (worktree DB): job page shows "Assessment v10" and "Version history · 9 earlier"; `/profile` edits without an approval step.
- Not exercised live: the copilot's wording with the new prompt (no `propose_job_snapshot`), `pnpm eval`.

## Job discovery foundation (M13)

- Offline: `pnpm check` (shared: screen reasons, whole-word title excludes, Europe expansion, salary floor only for stated pay in the same currency, backfill age limit, company keys; db: cross-board merge by company key + title and by shared apply URL, merge into a chat job, re-seen postings don't touch the job, re-screen hides/shows/promotes and judges age as of arrival with the backfill window, triage-threshold visibility, one run at a time, interrupted sweep, spend, run markers skip `discovery:` threads; agent: Himalayas paging and partial failures, LinkedIn mapping, pay parsing, searches per query × location, spend cap, 402, Apify runner start/poll/dataset/cost, orchestrator skips, budget, cursors, backfill caps). `pnpm e2e` 24/24 incl. `discovery.spec.ts` (Run now on fixture sources, merged duplicate with both badges, screened-out list, second run "seen before", settings change lets a dropped posting through).
- Browser (fixture stack, scratch DB): `/discovery` run → healthy source cards, runs table, screened-out reasons; `/jobs` source badges; `/settings/search` save → "1 new job let through". Studio link opens the workflow run (after Studio sign-in).
- Apify (MCP, 2026-11-10, ~$0.01): `valig/linkedin-jobs-scraper` returns full descriptions, `postedDate`, salary text, often an empty `applyUrl`; the `f_WT` workplace filter is ignored (on-site/hybrid results), so LinkedIn postings stay "remote unknown".
- Live (2026-11-10, worktree DB copy): one manual run. Himalayas: 256 fetched, 145 new jobs, 16 merged, 95 screened out (almost all "remote only from <non-EU/US country>", a few "junior", "sales", "talent acquisition"). LinkedIn: skipped, `APIFY_API_KEY` not in this worktree's env. Not exercised live yet: the LinkedIn source through the app, a scheduled fire in the main checkout.
