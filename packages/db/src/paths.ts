import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** Walks up from `start` to the directory containing pnpm-workspace.yaml. */
export function findWorkspaceRoot(start: string = process.cwd()): string {
  let dir = start;
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`No pnpm-workspace.yaml above ${start}`);
    dir = parent;
  }
  return dir;
}

/**
 * libSQL URL of the shared database. Every process (Next, `mastra dev`, Mastra's
 * bundled output, scripts) must resolve to the same file, so relative paths are avoided.
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const dataDir = join(findWorkspaceRoot(), "data");
  mkdirSync(dataDir, { recursive: true });
  return `file:${join(dataDir, "copilot.db")}`;
}

/**
 * DuckDB file for Mastra observability (traces, logs, metrics): next to the libSQL file with a
 * `.duckdb` extension, so a separate DATABASE_URL (e2e, tests) also gets its own observability store.
 */
export function resolveObservabilityPath(env: NodeJS.ProcessEnv = process.env): string {
  const url = resolveDatabaseUrl(env);
  if (!url.startsWith("file:")) return ":memory:";
  return `${url.slice("file:".length).replace(/\.db$/, "")}.duckdb`;
}
