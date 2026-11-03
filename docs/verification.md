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
