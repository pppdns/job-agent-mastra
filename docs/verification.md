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
| 2026-11-03 | M1 | Gateway free tier → Sonnet 5.5 | ❌ 403 `RestrictedModelsError` (resolved by funding the account). Client received only the sanitized summary; full error stayed in server log and trace |

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
