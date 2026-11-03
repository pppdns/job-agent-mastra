<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# apps/web — Next.js UI

- The browser only calls same-origin routes. `src/server/agent.ts` (`server-only`) adds the shared secret and calls the agent. `src/app/api/chat/route.ts` validates `{ threadId, message }` (`src/lib/chat-schema.ts`), builds the agent body in `src/server/chat-body.ts`, and streams `/chat` through; never forward client JSON to the agent.
- Chats: `/c/[threadId]` (chat id = Mastra thread id); `src/proxy.ts` redirects `/` to a fresh UUID. Thread list/history/rename/delete go through `src/server/threads.ts`; mutations are server actions in `src/app/actions.ts` that call `refresh()`.
- Messages: user text in a `Bubble`; assistant text via Streamdown with images and raw HTML disabled (an injected reply must not make the browser fetch URLs); tool parts as `Trace` rows (`src/components/tool-trace.tsx`). `globals.css` has an `@source` for Streamdown's classes: restart `next dev` after changing `@source`.
- Next keeps visited pages mounted but hidden (React Activity): a chat keeps streaming when you navigate away, and e2e locators must filter `{ visible: true }`.
- `src/server/env.ts` validates server env lazily, so `next build` doesn't need secrets.
- Cache Components and Partial Prefetching are on (Next 16.4 defaults). Read `node_modules/next/dist/docs/` before using data-fetching or caching APIs.
- UI: shadcn/ui (Radix Nova). `src/components/ui/` and `src/hooks/use-mobile.ts` are CLI-owned (don't edit; `ui/` is excluded from Biome). `SidebarMenuSkeleton` uses `Math.random()`, which breaks prerendering: use `Skeleton` with fixed widths; add or update with `pnpm dlx shadcn@<version> add <component>`. Chat composition follows the `shadcn` skill (`rules/chat.md`).
- Tests: Vitest for units; Playwright in `e2e/` (`playwright.config.ts` starts an isolated mock stack using system Chrome).
