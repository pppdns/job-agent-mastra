# How it works

A walkthrough of the moving parts, with diagrams. Details and rules live in the nearest `AGENTS.md`; this page links to them instead of repeating them.

- [System overview](#system-overview)
- [A chat turn, end to end](#a-chat-turn-end-to-end)
- [The copilot agent](#the-copilot-agent)
- [Tools](#tools)
- [Human-in-the-loop approvals](#human-in-the-loop-approvals)
- [Memory: what the agent knows](#memory-what-the-agent-knows)
- [Listing ingestion](#listing-ingestion)
- [Company research](#company-research)
- [Batch re-score](#batch-re-score)
- [Durable runs: refresh, reconnect, stop](#durable-runs-refresh-reconnect-stop)
- [Data model](#data-model)
- [Safety boundaries](#safety-boundaries)
- [Observability, usage and evals](#observability-usage-and-evals)

## System overview

Two processes on localhost share one SQLite file. The browser only talks to the Next.js app; the Next.js server talks to the Mastra server with a shared secret.

```mermaid
flowchart LR
  subgraph Browser
    UI[Chat UI<br/>useChat + shadcn]
  end
  subgraph web["apps/web (Next.js)"]
    RH[Route handlers<br/>/api/chat, /api/approvals]
    SA[Server actions<br/>approve, rename, re-score]
  end
  subgraph agent["apps/agent (Mastra server + Studio)"]
    CP[copilot agent<br/>durable]
    RS[researcher agent]
    RC[rescorer agent]
    T[Tools]
    MEM[Memory<br/>thread history + OM + working memory]
  end
  DB[(data/copilot.db<br/>libSQL: Mastra storage + app_* tables)]
  OBS[(data/copilot.duckdb<br/>traces, logs, metrics)]
  GW[Vercel AI Gateway<br/>Sonnet / Haiku]
  WEB[Tavily / Firecrawl]

  UI -->|same origin| RH & SA
  RH -->|shared secret, 127.0.0.1| CP
  SA -->|"@copilot/db"| DB
  CP --> T & MEM
  T --> RS & RC
  CP & RS & RC --> GW
  T -->|URL-guarded| WEB
  T -->|"@copilot/db"| DB
  MEM --> DB
  agent --> OBS
```

| Package | Role |
| --- | --- |
| `apps/web` | UI, proxy to the agent, and the **only** place approvals are decided ([AGENTS.md](../apps/web/AGENTS.md)) |
| `apps/agent` | Mastra agents, tools, memory, durable chat runs, scorers ([AGENTS.md](../apps/agent/AGENTS.md)) |
| `packages/db` | Drizzle schema, migrations and every data-access function, including the approval state machine ([AGENTS.md](../packages/db/AGENTS.md)) |
| `packages/shared` | Zod schemas shared by both apps (assessment, claims, profile) |

## A chat turn, end to end

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant B as Browser (useChat)
  participant W as Next /api/chat
  participant A as Mastra POST /chat
  participant C as copilot (durable run)
  participant DB as libSQL
  participant L as LLM (AI Gateway)

  U->>B: paste a job URL
  B->>W: { threadId, message }
  W->>W: validate, build agent body (never forward client JSON)
  W->>A: POST /chat + shared secret
  A->>DB: startRun (app_runs)
  A->>C: start durable run
  C->>DB: load approved profile + this chat's pending approvals
  C->>L: system prompt + thread memory + message
  L-->>C: tool call ingest_listing
  C->>DB: save job + source
  L-->>C: tool call save_job_draft
  C->>DB: save assessment vN
  L-->>C: short reply text
  C-->>A: stream chunks (sanitized, usage recorded)
  A-->>W: AI SDK UI message stream
  W-->>B: stream through
  B-->>U: trace rows, assessment card, reply
  A->>DB: endRun
```

The system prompt is rebuilt every turn from the database: fixed rules, the **approved profile** (with version and short fact handles like `f7`), this chat's **pending approvals**, and today's date last so the cached prefix stays stable (`buildInstructions` in [copilot.ts](../apps/agent/src/mastra/agents/copilot.ts)).

## The copilot agent

The copilot is an open-ended conversational agent, not a wizard. It decides which tools to call; app code decides what those tools are allowed to do.

```mermaid
flowchart TD
  M[User message] --> K{What is it?}
  K -->|URL or pasted listing| I[ingest_listing]
  I -->|complete| D[assess → save_job_draft<br/>reply ≤ 3 sentences<br/>card offers researchTopics as buttons]
  I -->|needs_paste / blocked| P[ask the user to paste the listing]
  K -->|"research X" or a research button| R[research_company<br/>1–3 decisive topics]
  R --> D2[summarize what matters → save_job_draft]
  K -->|lasting preference / 'Remember …'| PP[propose_profile_change<br/>takes effect after approval]
  K -->|'for this chat …'| WM[updateWorkingMemory<br/>thread only]
  K -->|hypothetical| N[discuss, change nothing]
  K -->|compare / recall| F[find_saved_jobs · get_job]
  K -->|'re-score stale jobs'| RS[rescore_jobs]
  K -->|unknown that changes the verdict| Q[ask one focused question]
```

Key behaviours, all from the prompt in [copilot.ts](../apps/agent/src/mastra/agents/copilot.ts) and [assessment-rules.ts](../apps/agent/src/mastra/agents/assessment-rules.ts):

- **Role vs fit.** Without a profile, an assessment is `role_only`; with one, it is `with_profile` and personal fit points must be `inference` citing current profile facts by handle.
- **Evidence classes.** Every point is `official`, `independent`, `anonymous`, `inference` or `unknown_conflicting`. Sourced classes must cite sources of the same job (checked in `@copilot/db`, not by the model).
- **Research on request.** Each assessment names 1–3 `researchTopics`; the chat card and the job page show them as "Research next" buttons that send a request naming the job id (`researchRequestText`). The copilot never researches by default.
- **No approval for assessments.** Every `save_job_draft` is the job's new current version; earlier versions stay as history.
- **Never claims success early.** Profile changes are "proposed" until the user approves them.

Models come from the AI Gateway: `main` (Sonnet) for the copilot, researcher and rescorer, `fast` (Haiku) for compaction and chat titles. `LLM_MODE=mock` swaps in a deterministic fake for tests and offline dev ([models.ts](../apps/agent/src/mastra/models.ts)).

## Tools

```mermaid
flowchart LR
  CP((copilot))
  subgraph free["Read and write freely"]
    IL[ingest_listing]
    SD[save_job_draft]
    FS[find_saved_jobs]
    GJ[get_job]
    WM[updateWorkingMemory]
  end
  subgraph propose["Propose only"]
    PC[propose_profile_change]
  end
  subgraph sub["Run a sub-agent"]
    RC[research_company]
    RJ[rescore_jobs]
  end
  CP --> IL & SD & FS & GJ & WM & PC & RC & RJ
  RC --> R1((researcher)) --> W1[web_search · extract_page · record_claim]
  RJ --> R2((rescorer<br/>structured output, no tools))
```

| Tool | Does | Writes |
| --- | --- | --- |
| `ingest_listing` | Reads a URL (via providers) or the pasted text from the latest user message | `app_jobs`, `app_sources` |
| `save_job_draft` | Saves the assessment as the job's new current version (no approval needed) | `app_job_drafts` |
| `propose_profile_change` | Creates a **pending** approval with exact add/modify/remove changes | `app_approvals` |
| `find_saved_jobs`, `get_job` | Full-text search and job detail; `includeListing` re-reads the stored listing | — |
| `research_company` | Runs the researcher under a budget, streams progress | `app_sources`, `app_claims` |
| `rescore_jobs` | Re-assesses stale jobs against the current profile, 3 at a time | `app_job_drafts` |
| `updateWorkingMemory` | Mastra built-in: "this chat only" notes | Mastra thread |

Rule violations raised by `@copilot/db` come back as `{ ok: false, error }` so the model can correct itself and retry.

## Human-in-the-loop approvals

Only profile changes the copilot proposes need approval. Approvals are **database rows, not paused agent runs**. `propose_profile_change` writes a pending row bound to a payload hash and a version; the user approves later in the UI; app code applies the change. This survives restarts and compaction, and the model has no tool that can approve anything.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant C as copilot
  participant DB as app_approvals
  participant UI as ApprovalCard (web)
  participant SA as decideApprovalAction (server action)

  C->>DB: propose_profile_change<br/>(payload, payload_hash, thread, base version)
  DB-->>C: pending approval id
  C-->>U: "proposed — approve it in the app"
  UI->>DB: GET /api/approvals/:id?threadId (404 for other chats)
  UI-->>U: shows the exact payload
  U->>SA: Approve (with the hash it displayed)
  SA->>DB: decideApproval
  alt same chat, same hash, still current
    DB->>DB: apply new profile version
    DB-->>UI: approved
  else payload or base moved
    DB-->>UI: stale (nothing applied)
  end
  Note over C,DB: Next turn: profile + pending approvals are re-injected into the prompt
```

```mermaid
stateDiagram-v2
  [*] --> pending: propose_profile_change (agent)
  pending --> approved: user approves in the same chat, hash matches, still current
  pending --> rejected: user rejects
  pending --> stale: profile moved past baseVersion
  approved --> [*]: profile vN+1 applied
```

What needs approval and what doesn't:

| Change | Approval? | Where it lives |
| --- | --- | --- |
| Job assessment | No, saved automatically; the latest version is current, earlier ones are history | `app_job_drafts` ("Saved · vN") |
| Profile change proposed in a chat | **Yes** | `app_profile_versions`, `app_profile_facts` |
| Profile edit on `/profile` (the user's own) | No, applies right away as a new version (recorded as an approved change) | same |
| "For this chat" assumption | No | Thread working memory |
| Research claims | No | `app_claims` |

Exact rules: [packages/db/AGENTS.md](../packages/db/AGENTS.md#profile-change-approvals).

## Memory: what the agent knows

Three layers, deliberately separated so that a chat can never "remember" something the user didn't approve, and chats never see each other.

```mermaid
flowchart TB
  subgraph Durable["Durable, global (app tables)"]
    PF[Approved profile vN<br/>facts with ids]
    JB[Saved jobs, assessment versions, claims]
  end
  subgraph Thread["Per chat (Mastra memory, thread scope)"]
    H[Message history]
    OM[Observational Memory<br/>observer compacts old messages]
    WM[Working memory<br/>local assumptions, open questions]
  end
  PF -->|injected every turn| P[System prompt]
  PA[Pending approvals for this chat] -->|injected every turn| P
  H & OM & WM --> P
  JB -->|only via find_saved_jobs / get_job| CP((copilot))
  P --> CP
```

- **No semantic recall, nothing resource-scoped.** Only the current thread is recalled ([memory.ts](../apps/agent/src/mastra/memory.ts)).
- **Compaction.** Once unobserved history passes `OM_MESSAGE_TOKENS` (default 30k), the Observer (fast model) turns older messages into an observation log; raw messages stay in storage. The chat shows a compaction line. The observer is told not to copy profile or approval state, since those are re-injected fresh.
- **Profile is never sourced from a summary or a web page**, only from approved rows.

## Listing ingestion

The server never fetches listing URLs itself; providers do, and every URL passes the URL guard (public http(s) only, re-checked on the provider's final URL). LinkedIn guest pages often show only a job card, so the tool falls back to the employer's ATS posting or asks for a paste. A URL that already belongs to a saved job (same LinkedIn id, canonical URL or listing snapshot URL) is answered from the database before any provider call; the copilot just says so and re-reads only when asked (`refresh: true`).

```mermaid
flowchart TD
  U[URL] --> G{url-guard}
  G -- private/unsafe --> B[blocked]
  G --> D{saved job<br/>for this URL?}
  D -- yes, no refresh --> AS[already_saved]
  D -- no --> L{LinkedIn?}
  L -- yes --> T1[Tavily extract → parse]
  T1 -- complete --> S[(save job + source)]
  T1 -- job card only --> A[search ATS domains<br/>match title + company]
  A -- match --> S
  A -- none --> P[needs_paste]
  T1 -- sign-in page --> P
  L -- no --> W[Tavily → Firecrawl → parse]
  W -- complete --> S
  W -- otherwise --> P
  X[Pasted text] --> S
```

Details: [apps/agent/src/ingest/AGENTS.md](../apps/agent/src/ingest/AGENTS.md).

## Company research

`research_company` runs a separate **researcher** agent from inside the tool (not a Mastra subagent), so app code owns its tools, budget and progress events.

```mermaid
sequenceDiagram
  autonumber
  participant C as copilot
  participant T as research_company
  participant B as ResearchBudget
  participant R as researcher
  participant P as Tavily / Firecrawl
  participant DB as app_sources / app_claims
  participant UI as chat timeline

  C->>T: jobId, 1–3 topics
  T->>R: generate (per-run tools)
  loop until done or budget hit
    R->>B: reserve (tool calls, time, est. USD)
    alt within budget
      R->>P: web_search / extract_page (URL-guarded)
      P-->>R: results (untrusted text)
      R->>DB: addSource (kind web)
      R->>DB: record_claim (topic, evidence class, sources, dates)
      T-->>UI: data-research-progress
    else limit reached
      B-->>R: abort → summarize what was recorded
    end
  end
  T-->>C: claims + budget status
  C->>C: summarize what matters → save_job_draft citing claims
```

- Default budget: 12 web calls, 2 minutes, ~$0.50 estimated ([budget.ts](../apps/agent/src/research/budget.ts)). Claims are saved as they are found, so a stopped or budget-limited run keeps partial results.
- Page text is wrapped as untrusted; a fixture page contains a prompt injection to test this.

Details: [apps/agent/src/research/AGENTS.md](../apps/agent/src/research/AGENTS.md).

## Batch re-score

After a profile change, earlier assessments are **stale** (they predate the current profile version). The "Re-score" button on `/jobs` starts a new chat that calls `rescore_jobs`.

```mermaid
flowchart LR
  B[/jobs: Re-score/] -->|new chat, fixed message| C((copilot))
  C -->|rescore_jobs| R[runRescore<br/>≤ 25 jobs, 3 at a time]
  R -->|profile + stored listing + claims| A((rescorer<br/>structured output))
  A --> D[saveDraft<br/>rejects if profile moved]
  R -->|data-rescore-progress| UI[results list]
```

Details: [apps/agent/src/rescore/AGENTS.md](../apps/agent/src/rescore/AGENTS.md).

## Job discovery

A Mastra workflow (`discover-jobs`) fetches new postings from job boards twice a day, plus "Run now" and backfills from `/discovery`. Postings failing a deliberately permissive deterministic screen stay postings; passing ones are deduped into jobs. Each new job then gets a fast-model triage score (0–100 + reason; under the threshold it's hidden), the run's best matches get a full assessment, and the matches are emailed (Resend). Details: [apps/agent/src/discovery/AGENTS.md](../apps/agent/src/discovery/AGENTS.md).

```mermaid
flowchart LR
  CRON["schedule 07:00/16:00<br/>(main checkout only)"] --> WF
  RUN["/discovery: Run now · Backfill"] -->|POST /discovery/run| WF
  subgraph WF[discover-jobs workflow]
    C[claim-run<br/>one at a time] --> F[fetch-sources] --> X[finish-run]
  end
  F --> HIM[Himalayas API<br/>free]
  F --> APIFY[Apify actor<br/>LinkedIn, per-run cap + monthly budget]
  F --> SCR{screenPosting<br/>clear misfits only}
  SCR -->|fails, with reasons| PO[(app_postings)]
  SCR -->|passes| DD[dedupe: apply URL or<br/>company key + title] --> J[(app_jobs + board snapshot)]
  J --> TRI[triage<br/>fast model, budgeted] --> ASS[assess best N<br/>main model] --> MAIL[email digest<br/>Resend]
  SET["/settings/search"] -->|save → rescreenPostings| PO
```

- **Sources:** free official feeds are read directly. Boards without one use pay-per-event Apify actors, which include their proxies.
- **Cost control:** runs are started by our code, with per-run caps and a 30-day budget check. Spend is recorded per source and run.
- **Hidden jobs:** discovered jobs hidden by the screen (or, later, the triage threshold) are filtered by `visibleJobs` in `listJobs`. Chat tools and re-score therefore only see jobs worth showing.

## Durable runs: refresh, reconnect, stop

Chat runs outlive the HTTP request. Closing the tab or refreshing never stops a run; Stop does.

```mermaid
sequenceDiagram
  participant B as Browser
  participant W as Next
  participant A as Mastra
  B->>W: POST /api/chat
  W->>A: POST /chat → run started, streaming
  Note over B: user refreshes
  B->>W: GET /api/chat/:threadId/stream (useChat resume)
  W->>A: GET /chat/:threadId/stream
  A-->>B: replay + live chunks (204 if nothing runs)
  B->>W: POST /api/chat/:threadId/stop
  W->>A: POST /chat/:threadId/stop → abort run
```

Runs are recorded in `app_runs`; runs left over from a crashed process are marked interrupted at startup. Several chats can run at once (one run per chat); the sidebar polls `GET /api/run-status` to show a spinner on running chats and a dot on replies not opened yet. Background: [docs/spikes/durable-resume.md](spikes/durable-resume.md).

## Data model

```mermaid
erDiagram
  app_jobs ||--o{ app_sources : "listing + research pages"
  app_jobs ||--o{ app_job_drafts : "assessment versions, latest is current"
  app_jobs ||--o{ app_claims : "research findings"
  app_claims }o--o{ app_sources : cites
  app_profile_versions ||--o{ app_profile_facts : contains
  app_profile_versions ||--o{ app_approvals : "change proposals (baseVersion)"
  app_runs ||--o{ app_run_events : "model + provider calls"
  app_jobs ||--o{ app_postings : "seen on (boards)"
  app_discovery_runs ||--o{ app_postings : "first seen in"
```

`app_search_settings` is a single JSON row (`SearchSettings`). `app_discovery_runs` keeps per-source results as JSON.

Mastra's own tables (threads, messages, working memory, observations, scores) live in the same libSQL file. Traces, logs and metrics go to DuckDB. Schema: [schema.ts](../packages/db/src/schema.ts).

## Safety boundaries

Deterministic code enforces everything that matters; the model only proposes.

| Concern | Enforced by |
| --- | --- |
| Approvals | `decideApproval` in `@copilot/db`, called only from a web server action on a user click; payload hash + thread + version checks. `/profile` edits (`editProfile`) come only from a server action too |
| Auth | Deployed: password login on the web app (`APP_PASSWORD`, signed session cookie checked in `src/proxy.ts`), agent port never public ([deploy.md](deploy.md)). Servers bound to 127.0.0.1; every agent route behind `SimpleAuth` with `AGENT_SHARED_SECRET`; memory pinned to the user's resource |
| Untrusted web text | URL guard on every fetch; page text marked untrusted; the UI renders replies without images or raw HTML |
| Research spend | `ResearchBudget` aborts on tool calls, time or estimated USD |
| Discovery spend | Per-run Apify caps (`maxTotalChargeUsd` on every actor run) and a 30-day budget check in `runDiscoverySources`; per-run model cap and triage cap (`DiscoveryBudget`); schedule only in the main checkout |
| Scraped data | Every posting validated with `postingInputSchema`, size-capped, links stripped from descriptions; board hosts fixed per adapter; the triager has no tools and a named hard conflict caps its score in code; the digest escapes every value and links only to the app |
| Data integrity | Zod schemas on tool input; `@copilot/db` rejects assessments citing other jobs' sources or stale profile versions; serialized writes |
| Secrets | Server-side env only, validated at startup; `SensitiveDataFilter` on traces; redaction in usage events |

## Observability, usage and evals

```mermaid
flowchart LR
  C[copilot / researcher / rescorer<br/>observer / title] -->|spans| DD[(DuckDB)] --> ST[Mastra Studio<br/>traces, logs, metrics]
  C -->|one row per model or provider call| RE[(app_run_events)] --> TP[Technical panel in chat<br/>tokens, est. cost, approvals]
  CASES[eval cases + fixtures] --> EX[pnpm eval experiments] --> SC[code scorers + LLM judges] --> REP[data/eval-report.md]
```

- Usage accounting: [apps/agent/src/usage/AGENTS.md](../apps/agent/src/usage/AGENTS.md).
- Evals and live scoring: [apps/agent/src/evals/AGENTS.md](../apps/agent/src/evals/AGENTS.md).
