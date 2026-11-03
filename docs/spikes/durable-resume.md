# Spike: durable agent + `useChat` resume (M2, 2026-11-03)

Goal: de-risk M7 (refresh/reconnect mid-run) before building on it. Result: **clean on the Mastra side; keep the approach.** Regression test: [`apps/agent/src/mastra/durable-resume.test.ts`](../../apps/agent/src/mastra/durable-resume.test.ts) (mock model, offline).

## What the test proves (`@mastra/core` 1.81, `@mastra/ai-sdk` 1.11, AI SDK 7)

- `createDurableAgent({ agent })` around an agent with our `chatMemory` streams normally; `toAISdkStream(output, { from: "agent", version: "v7" })` converts its output.
- Cancelling the client's reader mid-reply does **not** stop the run: it finishes server-side and persists both turns to the thread.
- `observe(runId)` replays the whole run from the in-memory event cache; `readUIMessageStream` rebuilds the full assistant message.
- Thread ownership (`belongs to resource …` error) is still enforced for durable runs.

## Constraints found

| Finding | Consequence for M7 |
| --- | --- |
| `chatRoute()` calls `agent.stream()` and has no durable/observe support | Replace `/chat` with two custom routes: `POST /chat` (durable `stream`, record `runId`) and `GET /chat/:threadId/stream` (`observe`, or 204 when no active run) |
| AI SDK `useChat({ resume: true })` calls `GET {api}/{id}/stream` on mount; `DefaultChatTransport` treats the resumed stream as a **full replay** by default | Matches `observe(runId)` without an offset: no client changes beyond `resume: true` and a Next proxy route |
| In a resumable setup, `stop()`/refresh only close the HTTP connection | Stop needs its own endpoint calling durable `abort(runId)` (M7 "Stop research") |
| Replay cache is in-process and cleared `cleanupTimeoutMs` (30 s) after the run ends | Refresh works while the run is live or just finished; after that the UI loads history from memory. Server restart loses replay (already accepted: plan simplification 1) |
| Durable agents don't emit the `data-thread-title` chunk yet | M7 must refresh the sidebar another way (e.g. refresh after `finish`, then once more shortly after) |
| Active run per thread must be stored by us | Small `app_runs` row or thread metadata keyed by thread id, cleared on finish/abort (fits M8 `runs` table) |

## Not covered

The browser half (`useChat` resume after a real page reload) was not exercised; it is standard AI SDK behaviour and gets an e2e test in M7.
