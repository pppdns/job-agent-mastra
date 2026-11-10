# Project

## Overview

Job Research Copilot: a private, single-user chat assistant that assesses job listings against an approved personal profile and researches the companies behind them. Built to learn the full Mastra agent stack (tools, memory, approvals, compaction, streaming, traces, evals). Intent: [project-brief.md](project-brief.md). Decisions and milestones: [docs/PLAN.md](docs/PLAN.md).

Hosted at https://job-copilot-c456e8.fly.dev: Fly.io app `job-copilot-c456e8` (region `fra`), one machine, password login. Pushes to `main` deploy it through GitHub Actions; production holds the user's real data. See [docs/deploy.md](docs/deploy.md).

## Tech Stack

pnpm workspaces + Turborepo, TypeScript, Mastra (agent server + Studio), Next.js App Router + AI SDK UI + shadcn/ui chat components, libSQL (SQLite) with Drizzle for app tables, Vercel AI Gateway for models, Tavily + Firecrawl for web access, Biome, Vitest, Playwright. Exact versions live in `package.json` files.

## Project Structure

- `apps/agent` — Mastra server (agents, tools, memory, scorers in `src/mastra/`). See [apps/agent/AGENTS.md](apps/agent/AGENTS.md)
- `apps/web` — Next.js UI; proxies to the agent server, runs approval actions. See [apps/web/AGENTS.md](apps/web/AGENTS.md)
- `packages/shared` — constants, Zod schemas and types shared by both apps (assessment shape in `src/assessment.ts`)
- `packages/db` — Drizzle schema, migrations, data-access functions, approval state machine. See [packages/db/AGENTS.md](packages/db/AGENTS.md)
- `scripts/` — `start-prod.sh` (container entrypoint), `fly-secrets.sh`, `agent-api.sh` (authenticated `mastra api`), `setup-env.sh`, `ports.sh` (per-checkout dev ports), `wait-for-idle.sh` (queue heavy tasks), `stop-dev.sh` (stop this checkout's servers), `sync-main.sh` (fast-forward local `main` to origin)
- `fixtures/` — synthetic listings/pages for tests and evals (no third-party text)
- `docs/` — plan, spikes, verification results

Internal packages export TypeScript source directly (no build step); Next and Mastra transpile them.

## Visual Design

Simple, polished, functional: shadcn/ui (Radix Nova preset) defaults. Clear visual distinction between transient (this chat) and durable (profile) memory, and between pending and approved profile changes.

## Key Conventions

- **Commit frequently, then push — without asking.** Commit after every small verified step (checks green), not at the end of a milestone, and push right after each commit. This is standing permission that overrides Claude Code's default of pushing only when asked. On a new branch the first push is `git push -u origin HEAD`. Force pushes still ask. The Stop hook blocks once if commits are unpushed. Imperative subject lines; never commit secrets or `.env*` files.
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
| `pnpm install` | Install; also points git at `.githooks/` and sets `push.autoSetupRemote` |
| `pnpm setup:env` | Create/extend `apps/agent/.env` + `apps/web/.env.local` with a shared secret (never prints values) |
| `pnpm db:migrate` | Apply Drizzle migrations for app tables |
| `pnpm dev` | Agent (http://127.0.0.1:4111, Studio) + web (http://127.0.0.1:3000); other ports in a worktree, see [Worktrees](#worktrees) |
| `pnpm check` | Biome + typecheck + unit tests (pre-commit and Claude Stop hook run this) |
| `pnpm fly:secrets` | Set the Fly app's secrets (asks for the login password; never prints values). Deploys run only from GitHub on push to `main`; don't `fly deploy` from a worktree: [docs/deploy.md](docs/deploy.md) |
| `pnpm ngrok` | ngrok tunnel to the web app (basic auth required; login in `apps/web/.env.local` as `NGROK_BASIC_AUTH`, optional `NGROK_DOMAIN`). Run next to `pnpm dev` |
| `pnpm e2e` | Playwright on an isolated mock stack; stop `pnpm dev` first |
| `pnpm eval` | Live eval suite (real copilot + LLM judge, web fixtures, own `data/eval.db`); costs money. Report in `data/eval-report.md` |
| `pnpm eval:studio` | Studio on the eval DB to browse experiments and scores; stop `pnpm dev` first |
| `pnpm agent:api …` | `mastra api` against the local agent with auth, e.g. `agent run copilot '{"messages":"hi"}'`, `trace list` |

Later: `pnpm smoke:live`. Evals: [apps/agent/src/evals/AGENTS.md](apps/agent/src/evals/AGENTS.md). Details: [docs/PLAN.md#verification-loops](docs/PLAN.md#verification-loops).

## Database

Single local libSQL file under `data/` (gitignored), shared by Mastra storage and app tables (`app_*`, managed by Drizzle in `packages/db`). Mastra observability (traces, logs, metrics) lives in a DuckDB file next to it (`data/copilot.duckdb`).

## Agent Workflow

**Plan thoroughly.** Explore code and docs before planning complex work, ask clarifying questions iteratively, and review a plan several times for issues and missed scope. Avoid over-engineering. If there are parts in the plan that are exceptionally complex, where the technical implementation could be vastly simplified by minor tradeoffs or decision changes, tell me and ask for my input about what small tradeoffs we can make for a much simpler plan.

**Keep docs in sync.** After a change, update the nearest `AGENTS.md`, the affected skill in `.agents/skills/`, and linked docs. Keep docs short, reference instead of duplicating, and use mermaid diagrams where they help. Write only what is important and relevant, worded unambiguously. Skip anything an agent can quickly find out from the code, or give it one brief line. New major features get an `AGENTS.md` in their directory.

**Verify continuously.** Use the loops in [docs/PLAN.md](docs/PLAN.md#verification-loops): `pnpm check` before commits, `mastra api` to run the agent and read traces, browser/Playwright for UI. Only claim a live integration works if it was exercised live.

## Worktrees

CLI worktrees (`claude -w`) branch from local `HEAD` (`worktree.baseRef` in `.claude/settings.json`); desktop-app worktrees ignore that and branch from the local `origin/main` ref, which may be stale. So the `SessionStart` hook runs [scripts/sync-main.sh](scripts/sync-main.sh) (fetch origin, fast-forward local `main` if its checkout is clean and it has no unpushed commits) and then fast-forwards a fresh worktree (clean, branch not pushed yet, no commits of its own) to `origin/main`. Nothing is ever merged or reset. Unpushed local `main` commits don't reach desktop worktrees, so push `main` first. Every worktree gets the env files plus a snapshot of `data/copilot.db` copied in via [.worktreeinclude](.worktreeinclude); after the sync, the same hook runs `pnpm install --frozen-lockfile` (a fast no-op when nothing changed), so dependencies match the lockfile even when another session moved `main`. Hooks resolve the session's checkout from their input `cwd`, because desktop worktree sessions run them from the main checkout. Each checkout has its own database (`data/` under its root) and its own port slot, so worktrees can run `pnpm dev` and `pnpm e2e` side by side: [scripts/ports.sh](scripts/ports.sh) gives the main checkout the default ports and each worktree the next free slot (web `3000+10k`, agent `4111+10k`, e2e `+1`), saved in its gitignored `.dev-ports`. The `SessionStart` hook prints a worktree's URLs; `scripts/ports.sh` prints them again. The root `pnpm` scripts (`dev`, `e2e`, `eval:studio`, `agent:api`, `ngrok`) pass the ports on, so start servers through them, not `pnpm --filter`. Browser MCPs run `--isolated`, so parallel sessions don't share a browser profile. Run `pnpm db:migrate` if the branch adds migrations. When the work in a worktree is done (checks green, pushed), open a GitHub PR against `main` with `gh pr create`. When you learn the PR was merged, run `scripts/sync-main.sh` so local `main` catches up.

**Share the machine.** Agents in other worktrees may be working at the same time. Before a CPU- or memory-heavy task (`pnpm eval`, `pnpm e2e`, `next build`), run [scripts/wait-for-idle.sh](scripts/wait-for-idle.sh) first (`scripts/wait-for-idle.sh && pnpm eval`, in the background since it can wait up to 30 min). It waits while load or memory use is high or another eval/e2e run is going, so heavy runs queue instead of failing or flaking each other. If it gives up, report that instead of running anyway. `pnpm check` and short commands don't need it.

**Stop servers you started.** When your task is done, or before handing back to the user for something that doesn't need them, stop the dev servers you started with [scripts/stop-dev.sh](scripts/stop-dev.sh). It stops only this checkout's port slot. If you leave them running so the user can try something, say so and stop them in your next turn once that's done. In the main checkout, never stop a `pnpm dev` you didn't start.

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
- [README.md](README.md) — human-facing overview and setup
- [docs/architecture.md](docs/architecture.md) — how it works, with mermaid diagrams (agent logic, tools, approvals, memory, research); update it when flows change
- [docs/PLAN.md](docs/PLAN.md) — agreed decisions and milestone plan
- [docs/verification.md](docs/verification.md) — live vs offline verification results
- [docs/deploy.md](docs/deploy.md) — Fly.io deployment, secrets, login, operating it
