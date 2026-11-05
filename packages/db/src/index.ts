import { join } from "node:path";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { findWorkspaceRoot, resolveDatabaseUrl } from "./paths";
import * as schema from "./schema";

export * from "./assessments";
export * from "./claims";
export { AssessmentError, hashPayload } from "./hash";
export * from "./jobs";
export { findWorkspaceRoot, resolveDatabaseUrl, resolveObservabilityPath } from "./paths";
export * from "./profile";
export * from "./runs";
export type {
  Approval,
  ApprovalStatus,
  Claim,
  Job,
  JobDraft,
  NewRunEvent,
  ProfileChangePayload,
  ProfileFact,
  Run,
  RunEvent,
  Source,
  SourceKind,
  SourceProvider,
} from "./schema";
export * as schema from "./schema";
export { canonicalWebUrl } from "./url";

export function createDb(url: string = resolveDatabaseUrl()) {
  // Agent and web both write this file: wait for locks instead of failing with SQLITE_BUSY.
  return drizzle(createClient({ url, timeout: 5_000 }), { schema });
}

export type Db = ReturnType<typeof createDb>;

/** Applies pending Drizzle migrations (idempotent). Resolved from the workspace root so bundled code finds them. */
export async function migrateDb(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: join(findWorkspaceRoot(), "packages/db/drizzle") });
}

/**
 * Deletes every row of every app table (jobs, drafts, approvals, profile, runs…); Mastra's
 * tables stay. Only for throwaway databases (evals).
 */
export async function resetAppTables(db: Db): Promise<void> {
  const tables = await db.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name glob 'app_*' and name not glob 'app_jobs_fts_*'`,
  );
  await db.run(sql`PRAGMA foreign_keys = OFF`);
  for (const { name } of tables) await db.run(sql.raw(`DELETE FROM "${name}"`));
  await db.run(sql`PRAGMA foreign_keys = ON`);
}
