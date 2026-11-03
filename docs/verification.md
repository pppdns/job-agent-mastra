# Verification log

Offline (mock/fixture) results and live results are kept separate. A live integration is only listed here after it was actually exercised.

## Live checks

| Date | Milestone | What | Result |
| --- | --- | --- | --- |
| 2026-11-03 | M1 | Browser → Next `/api/chat` → Mastra `/chat` → AI Gateway `anthropic/claude-sonnet-5.5`, streamed | ✅ Reply streamed; trace `success`, provider `gateway`, TTFT ≈ 2.0 s |
| 2026-11-03 | M1 | `pnpm agent:api agent run copilot` (live) | ✅ Usage includes cache read/write, 5m/1h cache creation, thinking tokens (native provider, not `vercel/` router string) |
| 2026-11-03 | M1 | Gateway free tier → Sonnet 5.5 | ❌ 403 `RestrictedModelsError` (resolved by funding the account). Client received only the sanitized summary; full error stayed in server log and trace |

## Offline checks (M1)

- `pnpm check`: Biome, typecheck, 9 agent + 3 db unit tests.
- `pnpm e2e` (mock model, isolated stack): streamed reply through proxy; agent rejects requests without the shared secret (401).

## Offline checks (M2)

- `pnpm check`: agent unit tests add chat memory (same-thread recall, no cross-thread leak, foreign resource rejected, history route scoped) and the durable resume spike; web unit tests cover the `/api/chat` request schema and agent body.
- `pnpm e2e` (7 tests): separate chat histories, reopen after reload, rename and delete, a thread inserted for another resource is absent from listings (even with `?resourceId=`), 403 on read/rename/delete, 404 on history, and a send from the UI fails with the sanitized error. New and existing routes return 401 without the secret.
- Not yet exercised live: title generation with the real fast model.
