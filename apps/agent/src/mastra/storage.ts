import { resolveDatabaseUrl, resolveObservabilityPath } from "@copilot/db";
import { MastraCompositeStore } from "@mastra/core/storage";
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
    },
  });
}
