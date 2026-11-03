# apps/agent — Mastra server

- Entry: `src/mastra/index.ts` (agents, storage, observability, server auth, routes). Register agents in code: file-based discovery isn't used.
- Env: `src/env.ts` validates at import and fails fast with variable names only. `LLM_MODE=mock` swaps in the deterministic model from `src/mastra/models.ts`.
- Models come from `getModel("main" | "fast")`, which returns the native `@ai-sdk/gateway` provider. Don't use `vercel/...` router strings (they lose cache/reasoning usage).
- Server: 127.0.0.1 only, `AGENT_PORT` (default 4111), every route behind `SimpleAuth` with `AGENT_SHARED_SECRET`. `/chat` is the AI SDK v7 `chatRoute`; `/threads/:threadId/ui-messages` returns a thread's history as AI SDK v7 UI messages.
- Memory: `src/mastra/memory.ts` (`chatMemory`). One thread per chat; only that thread's recent messages are recalled, so chats can't see each other. `mapUserToResourceId` pins all memory access to the authenticated user's resource; Mastra's built-in `/api/memory/threads*` routes then filter and 403 by resource. Custom routes must read `MASTRA_RESOURCE_ID_KEY` from the request context and check ownership themselves.
- Storage: `LibSQLStore` at `resolveDatabaseUrl()` from `@copilot/db` (same file as app tables).
- Only one `mastra dev` can run per project; `mastra build` is blocked while it runs.
- Look up APIs in `node_modules/@mastra/*/dist/docs/` (see the `mastra` skill) before writing Mastra code.
