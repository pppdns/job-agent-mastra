# Job Research Copilot — Mastra Implementation Brief

## Instructions to the implementing agent

Build this application as a personal learning project. This brief captures product intent, agreed behavior, and important constraints; it is not a prescribed implementation.

First inspect the existing repository and its instructions. Verify current framework APIs against official documentation rather than relying on remembered APIs. Make sensible implementation choices, explain material tradeoffs, and proceed autonomously with reversible development work. Ask only when genuinely blocked or when a decision substantially changes the scope.

Deliver working software, setup instructions, and meaningful verification. Never claim a live integration was tested when only mocked tests ran. Keep credentials out of source control. Do not deploy or publish unless separately requested.

## Purpose and scope

Build a conversational assistant that evaluates jobs against what it gradually learns about me and researches the companies behind them.

This is a private exercise to experience the full agent application stack: tools, reasoning, memory, isolated chat sessions, context compaction, permissions, human approvals, research, streaming, traces, and evals. It will not be sold or published. Aim for a satisfying first version in roughly one week.

Implement the complete application using Mastra.

Keep orchestration, memory integration, approvals, compaction, and observability idiomatic to Mastra.

## Core user experience

I paste a LinkedIn job URL OR the listing text into a chat. The assistant:
- Reads the available listing and gives a quick initial assessment.
- Explains relevant strengths, weaknesses, tradeoffs, and missing or uncertain information.
- Separates understanding the role from assessing personal fit: initially it may know little about me.
- Offers specific deeper research directions, rather than launching an expensive investigation by default.
- Investigates further when requested, autonomously within a configurable time/cost/tool budget.
- Asks focused questions when an unknown preference or background fact would materially affect its assessment.
- Proposes remembering new profile information and preference changes, requiring my approval.
- Saves research drafts automatically.
- Proposes a final job snapshot for approval.
- Supports follow-up questions and conversational comparisons with saved jobs.

The conversation is open-ended. Do not implement a mandatory wizard or hard-coded conversational sequence. The agent chooses appropriate tools and follow-up questions. Deterministic application code still controls authorization, approvals, data integrity, budgets, and safe tool execution.

Example:
1. I paste a listing.
2. The assistant identifies promising aspects and important unknowns.
3. I ask it to investigate the company and engineering practices.
4. It researches, streams progress, and cites its findings.
5. It asks whether regular on-call is acceptable if that matters.
6. I answer; it proposes remembering the preference.
7. I approve the preference update.
8. It revises the draft assessment and proposes a final snapshot.
9. I approve saving the snapshot.

## Research scope

The assistant should be able to investigate:
- What the company does: products, customers, market, business model, and how it makes money.
- Product and mission: problems solved, direction, and relevance to my interests.
- Engineering: technical challenges, stack, engineering practices, and credible evidence of engineering culture.
- Learning and ownership: likely responsibilities, autonomy, mentoring, and growth opportunities.
- Business health: funding or ownership, dated business developments, restructuring, and signs of stability or uncertainty.
- Role-specific facts: responsibilities, compensation, location eligibility, employment arrangements, timezone expectations, on-call, and other relevant requirements.

Prioritize questions that could change my decision. Do not exhaustively research every category for every job.

Attach sources and dates to material claims. Distinguish:
- Explicit statements in the listing or official company sources.
- Independent reporting.
- Anonymous employee reports or other weak evidence.
- Agent inference.
- Unknown or conflicting information.

Do not infer a specific team's culture from company-wide marketing. Do not equate funding with financial safety or interpret absent information as a negative fact. Preserve contradictory evidence and distinguish publication dates from event dates.

A useful assessment should contain:
- Short role/company overview.
- Strengths and weaknesses relative to known preferences.
- Hard-constraint conflicts versus softer tradeoffs.
- Important unknowns.
- Evidence and source links.
- Questions worth asking a recruiter.
- A qualified recommendation or suggested next investigation.

Avoid false precision from a dominant numeric match score. Explain tradeoffs in words; uncertainty should be visible.

## Listing ingestion and web tools

Support both URLs and pasted text from day one.

LinkedIn feasibility was checked at a documentation/provider-claim level, not by testing paid APIs:
- Tavily's official MCP implementation describes advanced extraction as appropriate for LinkedIn.
- Firecrawl documents employer/ATS job-board extraction.
- Specialist hosted Apify actors advertise public LinkedIn job extraction without login/cookies.

Treat all of these as candidates to validate, not guaranteed integrations.

Start with a short spike using several real public LinkedIn job URLs. Prefer a minimal service stack:
- Tavily is a reasonable candidate for search and extraction.
- Firecrawl is a candidate for general page extraction and interaction.
- A specialist extraction provider can be added if needed.
- Use a hosted browser when actual navigation or interaction adds value; avoid redundant providers.

Fallback behavior:
1. Attempt public listing extraction.
2. If blocked, incomplete, or a login wall, try to locate the matching employer/ATS listing.
3. If necessary, ask me to paste the description.
4. Clearly state which source was actually read and whether extraction is incomplete.

Never evaluate a snippet or login page as if it were the full listing. Verify the identity of a matching employer listing. Do not require LinkedIn credentials or session cookies for the initial version.

Browser tools should be able to navigate public sites, expand content, and inspect relevant pages when extraction is insufficient. Do not force browser interactions where a search or extraction API is enough.

Persist source text or bounded snapshots with provenance and retrieval timestamps so findings can be reviewed after pages change.

## Chat sessions, memory, and compaction

Provide ChatGPT-style separate chat sessions:
- New chat, conversation history, reopen a session, and basic session titles.
- Each session has its own messages, active research, temporary assumptions, pending approvals, and compacted context.
- Starting a new chat must not load summaries of all previous chats.
- Approved global profile/preferences are available across sessions.
- Retrieve saved jobs and evidence only when relevant.

Start with NO assumed personal profile. Learn only from what I tell the app. Do not seed facts from this brief, developer assumptions, or other ChatGPT history.

Separate:
1. Approved global background facts and preferences.
2. Session-local context and exceptions.
3. Job-specific data, research drafts, and approved snapshots.

Preference/profile behavior:
- Ask only questions that materially improve the current task; no mandatory onboarding questionnaire.
- Require explicit approval before adding, modifying, or removing persistent profile information, whether proposed through chat or edited in the UI.
- Display the exact proposed changes, with approve/reject controls.
- Distinguish hard requirements, soft preferences, and job-specific exceptions.
- "For this chat, include London roles" is local.
- "Remember I am open to relocating to London" proposes a global update.
- Hypothetical discussion must not silently alter memory.
- Approved changes supersede old preferences; retain a simple version/audit history.
- Allow me to inspect and correct the profile through chat and a simple UI.
- Make the difference between a transient conversational answer and durable approved memory clear.

Implement context compaction when a session approaches its context budget:
- Prefer the framework's supported mechanism where appropriate.
- Compact conversation history and bulky tool output; keep current task state coherent.
- Preserve unresolved questions, relevant local assumptions, evidence references, and pending approval identifiers.
- Persist original messages and research outside the model context.
- Load canonical approved preferences when needed; do not rely on a lossy summary as their source of truth.
- Pending approval payloads and execution state must survive independently of compaction.
- Expose a compaction event in the technical panel.

## Database and records

Use a simple/free database and a small UI. Do NOT integrate Notion.

Choose a database appropriate to the runtime; SQLite is fine for a local prototype, while hosted Postgres/Supabase is reasonable for separate or serverless deployment. Do not assume a persistent local disk exists in a serverless environment. Keep setup simple and document the choice.

Conceptually persist:
- User/profile identity, even if initially single-user.
- Sessions and messages.
- Versioned approved profile facts/preferences.
- Jobs and original listing provenance.
- Research sources, claims, drafts, and unresolved questions.
- Approved job snapshots.
- Pending/resolved approvals.
- Runs, progress events, usage, and trace references.

A job draft can evolve automatically. Saving a final record requires approval of an exact snapshot. Subsequent research creates or updates a draft; it must not silently overwrite an approved snapshot. Approval creates a new approved version while preserving earlier versions.

Record which profile version an assessment used. When preferences change, indicate that an assessment may need review. Do not automatically rewrite approved records.

Deduplicate jobs using stable listing identifiers/canonical URLs and sensible matching. Retried writes and duplicate approval submissions must be idempotent.

## Conversational comparisons

Include conversational comparison:
- "Compare this job with the Acme role I saved."
- "Which of these best fits what I have told you?"
- Retrieve relevant records without loading the entire job database into every chat.
- Ask for clarification if a job reference is ambiguous.
- Explain criteria, tradeoffs, evidence quality, and missing data.
- Identify stale assessments when current preferences differ from the version used.

A dedicated comparison dashboard and automatic global ranking are not required.

## UI and streaming

Use Next.js and TypeScript with a simple, polished, functional UI:
- Chat-history sidebar and New chat.
- Streaming conversation.
- Jobs list and job detail view with draft/approved distinction.
- Profile/preferences view.
- Source links and evidence.
- Approval cards.
- Visible research progress.
- Expandable technical details.

Vercel AI SDK is a preferred candidate for chat streaming and model integration where it fits. Mastra documents an AI SDK UI adapter; verify current APIs. Do not force a separate AI SDK agent loop around Mastra's own execution.

The user already uses Vercel AI Gateway and is comfortable paying for hosted tools. Prefer reusing Gateway where supported without sacrificing framework features. Keep provider/model selection configurable.

Do not assume chat streaming belongs inside a request that must remain open for the entire research run. Use a runtime-appropriate execution/persistence approach. A refresh or disconnected stream should not lose research state.

Prefer the simplest architecture compatible with durable runs and refresh/reconnect behavior. A monorepo with shared types is reasonable; UI and agent runtime may deploy separately if useful. Local development must be documented.

## Progress and technical visibility

Stream actual execution events into the UI, for example:
- Reading the listing.
- Searching for company information.
- Investigating engineering practices.
- Checking conflicting location requirements.
- Retrying a failed extraction.
- Waiting for approval.
- Completed, blocked, cancelled, or budget-limited.

Do not invent progress percentages or expose private chain-of-thought. Brief action explanations, tool events, evidence, and conclusions are sufficient.

An expandable technical panel should show, where available:
- Run ID and trace link.
- Framework, model, and provider.
- Tool/API call names, status, duration, and sanitized arguments/results.
- Search queries and visited URLs.
- Calls grouped by LLM, search, extraction, and browser service.
- Input/output tokens and cached/reasoning usage when the provider exposes them.
- Estimated LLM cost and external-service cost separately.
- Total duration and time to first response.
- Retries, errors, approval events, and compaction events.

Show per-run and session totals. Label estimates and unavailable data honestly. Do not double count framework and gateway observations of the same call. Do not create extra model calls just to generate continuous progress messages.

Support Stop research, budget-limit events, and reconnecting to an ongoing run after refresh. Cancellation should stop scheduling new work and cancel in-flight work where supported. Preserve partial results and identify any charges that may still occur.

## Permission and security defaults

No shell tools, arbitrary code execution, or general-purpose execution sandbox is required. Use hosted/isolated browser execution where needed.

Implement layered controls:
- Store tool credentials in server-side environment variables or a supported secret store.
- Never expose credentials in browser bundles, model prompts, tool results, or logs/traces.
- Provide a placeholder-only .env.example and validate configuration.
- Use narrowly scoped tools and database operations, not model-generated SQL or unrestricted network access.
- Validate tool arguments and outputs with schemas.
- Enforce session/resource ownership on the server. A single-user local mode is acceptable; document its boundary. Do not expose an unauthenticated remotely accessible app.
- Validate URLs, redirects, and network targets; block private/internal/link-local endpoints and unsafe schemes. Apply checks to browser navigation and provider fetches as far as provider capabilities permit. Document residual gaps.
- Treat job listings, fetched pages, snippets, and retrieved source documents as untrusted DATA.
- Web content cannot authorize profile updates, final snapshots, or access to another session.
- Keep trusted instructions separate from source content, preserve provenance, and do not promote quoted page instructions into system/tool policy.
- Enforce approvals outside the model; bind approval to exact payload/version and reject stale or cross-session approvals.
- Consider a purpose-built or model-based injection detector as an optional extra layer, never the sole defense or proof of safety.
- Redact sensitive fields in telemetry and limit tool output sizes.
- Bound retries, concurrency, elapsed time, tool calls, and spend.
- Make budgets configurable with practical defaults; reserve/check budgets before launching additional work. Explain that billing/token reporting may make an exact hard monetary cap impossible.
- Ask for help when blocked rather than looping indefinitely.

Search/extraction and draft writes can run automatically. Global memory mutations and final job snapshots require approval. No applications, recruiter messages, purchases, or other external consequential actions belong in the initial scope.

## Evals and testing without an existing dataset

There is no pre-existing dataset. Build a small reproducible fixture set from synthetic listings/pages and a few saved public examples. Do not make regression tests depend on live pages.

Target approximately 15–20 meaningful scenarios covering:
- Correct extraction and explicit unknowns.
- Remote wording that does not establish eligibility.
- Compensation absent or ambiguously expressed.
- Conflicting or dated company evidence.
- Distinguishing role strengths from personal fit.
- Relevant clarification questions without excessive questioning.
- Approved memory updates versus hypotheticals/local exceptions.
- Memory shared across sessions without conversation leakage.
- Preserving preferences and pending actions through compaction.
- Comparing jobs using current preferences and flagging stale assessments.
- Login walls, incomplete extraction, and fallback to pasted text.
- Prompt injection attempting to change memory, reveal credentials, or bypass approval.
- Unauthorized, stale, or repeated approval submissions.
- Retry after a write succeeds but its response is lost.
- Budget exhaustion, cancellation, and reconnect/restart recovery.

Use deterministic checks for authorization, state transitions, idempotency, constraint handling, and provenance. Use rubric-based model judges for groundedness, usefulness, uncertainty handling, and question quality. Report judge/model versions and avoid treating a judge score as definitive truth.

Include framework-native traces/evals where supported. Add another platform only if it fills a concrete gap; do not assemble an observability stack for its own sake. Correlate eval results with run traces so failures can be diagnosed.

Separate offline fixture regression results from live smoke-test results. Record latency, usage, estimated cost, success/failure, and relevant quality scores.

## Suggested implementation sequence

1. Inspect the repository, verify current official Mastra APIs, and document a minimal architecture.
2. Validate listing extraction with a few representative URLs and implement pasted-text fallback.
3. Build one end-to-end slice: chat session → listing → initial assessment → automatic draft → approval → saved snapshot.
4. Add approved profile memory, local exceptions, retrieval, and conversational comparisons.
5. Add deeper company research, source-backed uncertainty, and real progress events.
6. Add compaction, budget handling, failure recovery, cancellation, and reconnect behavior.
7. Finish technical visibility, security checks, fixtures/evals, and setup documentation.
8. Document lessons and Mastra-specific implementation decisions.

Treat these as implementation milestones, not a forced user-facing workflow. Keep a working vertical slice as the priority.

## Acceptance criteria

The first implementation is successful when:
- I can start independent chats, reopen them, and avoid mixing conversation context.
- I can paste job text or a supported URL and receive a quick, qualified initial assessment.
- Failed extraction produces an honest fallback instead of fabricated analysis.
- I can request deeper research and see actual progress, evidence, usage, and errors.
- The assistant learns only what I tell it and requires approval before durable profile changes.
- Approved preferences are available in a new session, while local assumptions remain local.
- Research drafts persist automatically.
- Final job snapshots require approval, remain versioned, and are not silently overwritten.
- I can compare saved jobs conversationally.
- Compaction works without losing canonical memory or pending approvals.
- Refresh/reconnect, cancellation, retries, and budget limits behave predictably.
- Untrusted pages cannot bypass tool permissions or approval requirements.
- A compact eval suite and trace inspection make important failures observable.
- The README explains setup, required accounts/keys, run/eval commands, architecture, limitations, and which integrations were actually tested.

## Out of scope for the initial version

- Automatic job discovery or scheduled monitoring.
- Submitting applications or contacting recruiters.
- LinkedIn account automation requiring credentials/cookies.
- Notion integration.
- Mandatory CV upload or onboarding questionnaire.
- Arbitrary code execution.
- A dedicated comparison dashboard or automatic global ranking.
- Enterprise multi-tenancy or production deployment.

## Official references to verify during implementation

These are starting points; consult their current contents and resolve current package versions.

- Mastra: https://mastra.ai/docs
- Mastra AI SDK UI: https://mastra.ai/integrations/agentic-ui/ai-sdk-ui
- Vercel AI SDK: https://ai-sdk.dev/docs
- Tavily: https://docs.tavily.com
- Tavily MCP source: https://github.com/tavily-ai/tavily-mcp
- Firecrawl: https://docs.firecrawl.dev
- Firecrawl job-board example: https://www.firecrawl.dev/blog/scrape-job-boards-firecrawl-openai

