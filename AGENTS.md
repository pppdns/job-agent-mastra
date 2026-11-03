# Project

## Overview

Job Research Copilot: a private, single-user chat assistant that assesses job listings against an approved personal profile and researches the companies behind them. Built to learn the full Mastra agent stack (tools, memory, approvals, compaction, streaming, traces, evals). Intent: [project-brief.md](project-brief.md). Decisions and milestones: [docs/PLAN.md](docs/PLAN.md).

## Tech Stack

pnpm workspaces + Turborepo, TypeScript, Mastra (agent server + Studio), Next.js App Router + AI SDK UI + shadcn/ui chat components, libSQL (SQLite) with Drizzle for app tables, Vercel AI Gateway for models, Tavily + Firecrawl for web access, Biome, Vitest, Playwright. Exact versions live in `package.json` files.

## Project Structure

- `apps/agent` — Mastra server (agents, tools, memory, scorers in `src/mastra/`). See [apps/agent/AGENTS.md](apps/agent/AGENTS.md)
- `apps/web` — Next.js UI; proxies to the agent server, runs approval actions. See [apps/web/AGENTS.md](apps/web/AGENTS.md)
- `packages/shared` — constants, Zod schemas and types shared by both apps
- `packages/db` — Drizzle schema, migrations, data-access functions
- `scripts/` — `agent-api.sh` (authenticated `mastra api`), `setup-env.sh`
- `fixtures/` (later) — offline listings/pages for tests and evals
- `docs/` — plan, spikes, verification results

Internal packages export TypeScript source directly (no build step); Next and Mastra transpile them.

## Visual Design

Simple, polished, functional: shadcn/ui (Radix Nova preset) defaults. Clear visual distinction between draft vs approved records and transient vs durable (approved) memory.

## Key Conventions

- **Commit frequently.** Commit after every small verified step (checks green), not at the end of a milestone. Imperative subject lines; never commit secrets or `.env*` files.
- **Plan:** work follows the milestones in [docs/PLAN.md](docs/PLAN.md); update its checkboxes as items land.
- **Verify Mastra / AI SDK / Next APIs before writing code** — use the `mastra` skill (embedded docs in `node_modules/@mastra/*/dist/docs`) and official docs; training-data APIs are often outdated.
- **Deterministic code owns safety:** approvals, authorization, budgets, URL validation, and DB writes are enforced in app code, never left to the model. Fetched web content is untrusted data.
- **No secrets in config, prompts, logs, or traces.** Server-side env vars only, validated at startup; `.env.example` holds placeholders. Agents never read `.env*` files.
- **Dependencies:** pnpm enforces a 24h minimum release age. Pin to the newest version older than that; revert any `minimumReleaseAgeExclude` entries pnpm auto-adds to `pnpm-workspace.yaml`. Shared versions go in the workspace `catalog:`.
- **Don't commit until `pnpm check` passes** (the pre-commit hook enforces it).

## Third-Party Services

- Vercel AI Gateway — all LLM calls (`AI_GATEWAY_API_KEY`)
- Tavily — search/extract (`TAVILY_API_KEY`)
- Firecrawl — scrape/extract, optional hosted browser (`FIRECRAWL_API_KEY`)

## Main Commands

| Command | What it does |
| --- | --- |
| `pnpm install` | Install; also points git at `.githooks/` |
| `pnpm setup:env` | Create/extend `apps/agent/.env` + `apps/web/.env.local` with a shared secret (never prints values) |
| `pnpm db:migrate` | Apply Drizzle migrations for app tables |
| `pnpm dev` | Agent (http://127.0.0.1:4111, Studio) + web (http://127.0.0.1:3000) |
| `pnpm check` | Biome + typecheck + unit tests (pre-commit and Claude Stop hook run this) |
| `pnpm e2e` | Playwright on an isolated mock stack; stop `pnpm dev` first |
| `pnpm agent:api …` | `mastra api` against the local agent with auth, e.g. `agent run copilot '{"messages":"hi"}'`, `trace list` |

Later: `pnpm eval`, `pnpm smoke:live`. Details: [docs/PLAN.md#verification-loops](docs/PLAN.md#verification-loops).

## Database

Single local libSQL file under `data/` (gitignored), shared by Mastra storage and app tables (`app_*`, managed by Drizzle in `packages/db`).

## Agent Workflow

**Plan thoroughly.** Explore code and docs before planning complex work, ask clarifying questions iteratively, and review a plan several times for issues and missed scope. Avoid over-engineering. If there are parts in the plan that are exceptionally complex, where the technical implementation could be vastly simplified by minor tradeoffs or decision changes, tell me and ask for my input about what small tradeoffs we can make for a much simpler plan.

**Keep docs in sync.** After a change, update the nearest `AGENTS.md`, the affected skill in `.agents/skills/`, and linked docs. Keep docs short, reference instead of duplicating, and use mermaid diagrams where they help. Write only what is important and relevant, worded unambiguously. Skip anything an agent can quickly find out from the code, or give it one brief line. New major features get an `AGENTS.md` in their directory.

**Verify continuously.** Use the loops in [docs/PLAN.md](docs/PLAN.md#verification-loops): `pnpm check` before commits, `mastra api` to run the agent and read traces, browser/Playwright for UI. Only claim a live integration works if it was exercised live.

## Skills

Installed in `.agents/skills/` (symlinked into `.claude/skills/`, tracked in `skills-lock.json`). Add with `pnpm dlx skills add <owner/repo> -s <skill> -a universal claude-code -y`; update with `pnpm dlx skills update`.

- `mastra` — Mastra APIs, docs lookup, `mastra api` CLI, traces, evals
- `ai-sdk` — AI SDK (`useChat`, streaming, tools)
- `next-dev-loop` — verify Next.js runtime behaviour (needs `agent-browser` CLI; otherwise use Playwright/Chrome DevTools MCP)
- `vercel-react-best-practices` — React/Next.js performance patterns
- `shadcn` — shadcn/ui components and chat UI composition
- `turborepo` — `turbo.json`, task pipelines, caching

Claude Code reads this `AGENTS.md` directly. Do not add a `CLAUDE.md` or `CLAUDE.local.md`: either one makes Claude Code stop loading `AGENTS.md`.

## Documentation Index

- [project-brief.md](project-brief.md) — product intent and constraints
- [docs/PLAN.md](docs/PLAN.md) — agreed decisions and milestone plan
- [docs/verification.md](docs/verification.md) — live vs offline verification results
