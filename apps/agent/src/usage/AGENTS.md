# Usage accounting

One `app_run_events` row per model call and per provider call; totals are sums over rows (`totalsOf` in `@copilot/db`), so nothing is counted twice.

| Source | How it is captured | Actor |
| --- | --- | --- |
| Copilot model steps | `step-finish` chunks in `/chat` (`recordChunk`) | `copilot` |
| Researcher model steps | `onStepFinish` in `runResearch` | `researcher` |
| Observational Memory calls | OM `hooks.onObservationEnd/onReflectionEnd` → `recordMemoryCall` | `observer` / `reflector` |
| Chat title | `meteredModel` middleware on the title model | `title` |
| Tavily / Firecrawl calls | `meterWeb` wrapper (each retry attempt is its own row) | `ingest` / `researcher` |
| Tool calls, retries, compaction, errors | chunks / research progress | — |

- `RunRecorder` buffers events until the durable run id exists, then writes in order; tools find it with `recorderFor(threadId)`. Background calls (OM, title) attach to the chat's active or latest run.
- Costs: `prices.ts` static table (cache reads 10%, 5-minute cache writes 125% of input); always shown as estimates.
- Event details pass through `sanitizeForEvent` (secret-looking keys redacted, page text omitted, bounded size). Traces use `SensitiveDataFilter` with `TRACE_SENSITIVE_FIELDS` (`src/mastra/index.ts`).
- Check against Studio: `pnpm agent:api trace get <traceId> --verbose` — each `model_step` span should have exactly one `llm` event with equal tokens (span queries aren't supported by the libSQL store).
