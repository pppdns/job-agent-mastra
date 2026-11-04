import { existsSync } from "node:fs";
import { join } from "node:path";
import { findWorkspaceRoot, resolveDatabaseUrl, resolveObservabilityPath } from "@copilot/db";
import { MastraCompositeStore, type StorageDomains } from "@mastra/core/storage";
import { DuckDBStore } from "@mastra/duckdb";
import { LibSQLStore } from "@mastra/libsql";

/**
 * Mastra storage: libSQL (shared with the app tables) for memory, workflows and the rest;
 * DuckDB for observability, because Studio's logs and metrics pages (and its trace token/cost
 * columns and filters) need an OLAP store. DuckDB holds a file lock: one process per file.
 */
export function createStorage(env: NodeJS.ProcessEnv = process.env): MastraCompositeStore {
  return new MastraCompositeStore({
    id: "copilot-storage",
    default: new LibSQLStore({ id: "copilot-libsql", url: resolveDatabaseUrl(env) }),
    domains: {
      observability: new DuckDBStore({ id: "copilot-duckdb", path: resolveObservabilityPath(env) })
        .observability,
      ...evalDatasetDomains(env),
    },
  });
}

/**
 * Plain `pnpm dev` (no DATABASE_URL) shows the eval suite's datasets and experiments in Studio by
 * reading them from `data/eval.db`. A convenience view only: their scores and traces stay in the
 * eval DB / eval DuckDB, so Studio shows experiments without them. Eval, e2e and tests set
 * DATABASE_URL and keep everything in their own database.
 */
function evalDatasetDomains(env: NodeJS.ProcessEnv): Partial<StorageDomains> {
  if (env.DATABASE_URL) return {};
  const evalDb = join(findWorkspaceRoot(), "data", "eval.db");
  if (!existsSync(evalDb)) return {};
  const { datasets, experiments } = new LibSQLStore({
    id: "copilot-eval-libsql",
    url: `file:${evalDb}`,
  }).stores;
  return { datasets, experiments };
}
