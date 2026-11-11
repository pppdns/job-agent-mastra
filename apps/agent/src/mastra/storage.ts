import { existsSync } from "node:fs";
import { join } from "node:path";
import { findWorkspaceRoot, resolveDatabaseUrl, resolveObservabilityPath } from "@copilot/db";
import {
  MastraCompositeStore,
  type PruneResult,
  type RetentionConfig,
  type StorageDomains,
} from "@mastra/core/storage";
import { DuckDBStore } from "@mastra/duckdb";
import { LibSQLStore } from "@mastra/libsql";

/** How long traces, logs, metrics, scores and feedback stay in DuckDB (Studio's history). */
export const OBSERVABILITY_MAX_AGE = "7d";

const week = { maxAge: OBSERVABILITY_MAX_AGE } as const;
export const RETENTION = {
  observability: { spans: week, logs: week, metrics: week, scores: week, feedback: week },
} satisfies RetentionConfig;

export type CopilotStorage = {
  storage: MastraCompositeStore;
  /**
   * Deletes observability rows past `OBSERVABILITY_MAX_AGE` in bounded batches, then checkpoints
   * DuckDB so the freed space is reused (pruning alone doesn't). Rows left over (`done: false`)
   * go on the next call.
   */
  pruneObservability: (signal?: AbortSignal) => Promise<PruneResult[]>;
};

/**
 * Mastra storage: libSQL (shared with the app tables) for memory, workflows and the rest;
 * DuckDB for observability, because Studio's logs and metrics pages (and its trace token/cost
 * columns and filters) need an OLAP store. DuckDB holds a file lock: one process per file.
 * Only observability has a retention policy: chat history and workflow state are kept.
 */
export function createStorage(env: NodeJS.ProcessEnv = process.env): CopilotStorage {
  const duck = new DuckDBStore({ id: "copilot-duckdb", path: resolveObservabilityPath(env) });
  const storage = new MastraCompositeStore({
    id: "copilot-storage",
    default: new LibSQLStore({ id: "copilot-libsql", url: resolveDatabaseUrl(env) }),
    domains: { observability: duck.observability, ...evalDatasetDomains(env) },
    retention: RETENTION,
  });
  return {
    storage,
    pruneObservability: async (signal) => {
      const results = await storage.prune({ maxRows: 50_000, pauseMs: 25, signal });
      if (results.some((r) => r.deleted > 0)) await duck.db.execute("CHECKPOINT");
      return results;
    },
  };
}

/**
 * Plain `pnpm dev` (no DATABASE_URL) shows the eval suite's datasets and experiments in Studio by
 * reading them from `data/eval.db`. A convenience view only: their scores and traces stay in the
 * eval DB / eval DuckDB, so Studio shows experiments without them. Eval, e2e and tests set
 * DATABASE_URL and keep everything in their own database.
 */
export function evalDatasetDomains(
  env: NodeJS.ProcessEnv,
  root: string = findWorkspaceRoot(),
): Partial<StorageDomains> {
  if (env.DATABASE_URL) return {};
  const evalDb = join(root, "data", "eval.db");
  if (!existsSync(evalDb)) return {};
  const { datasets, experiments } = new LibSQLStore({
    id: "copilot-eval-libsql",
    url: `file:${evalDb}`,
  }).stores;
  return { datasets, experiments };
}
