# Batch re-score

`rescore_jobs` (`src/mastra/tools/rescore-jobs.ts`) → `runRescore` (`run.ts`). Started by the copilot, usually from the "Re-score" or "Re-score all" button on `/jobs` (a server action that starts the run in a new chat and opens it).

```mermaid
flowchart LR
  B[/jobs button/] -->|new chat, fixed message| C[copilot]
  C -->|rescore_jobs| R[runRescore]
  R -->|per stale job, 3 at a time| A[rescorer agent<br/>structured output, no tools]
  A --> D[saveDraft<br/>profileVersion check]
  R -->|data-rescore-progress| UI[chat: progress + results]
```

- One fresh model call per job (profile + stored listing via `latestListingSource` + the job's research claims), so cost grows linearly. At most `MAX_RESCORE_JOBS` (25) per batch; the rest are reported as `skipped`.
- Default set: jobs whose current assessment predates the current profile (`profileStale`). `all` takes every assessed active job (the "Re-score all" button on `/jobs`, behind a confirm dialog; e.g. to fill in fields added later), stale first, then least recently updated, so repeated batches work through the list. `jobIds` re-scores specific jobs.
- `saveDraft` gets the profile version the prompt used and rejects the assessment if the profile moved meanwhile. Each saved result is the job's new current version (no approval) and stays if the run is stopped.
- Usage is recorded as actor `rescorer`. Offline: the mock model answers structured output with a fixed `with_profile` assessment citing the listing source.
