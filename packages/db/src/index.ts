import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { findWorkspaceRoot, resolveDatabaseUrl } from "./paths";
import * as schema from "./schema";

export * from "./assessments";
export * from "./claims";
export { AssessmentError, hashPayload } from "./hash";
export * from "./jobs";
export { findWorkspaceRoot, resolveDatabaseUrl } from "./paths";
export * from "./profile";
export type {
  Approval,
  ApprovalPayload,
  ApprovalStatus,
  Claim,
  Job,
  JobDraft,
  JobSnapshot,
  ProfileChangePayload,
  ProfileFact,
  SnapshotPayload,
  Source,
  SourceKind,
  SourceProvider,
} from "./schema";
export * as schema from "./schema";

export function createDb(url: string = resolveDatabaseUrl()) {
  // Agent and web both write this file: wait for locks instead of failing with SQLITE_BUSY.
  return drizzle(createClient({ url, timeout: 5_000 }), { schema });
}

export type Db = ReturnType<typeof createDb>;

/** Applies pending Drizzle migrations (idempotent). Resolved from the workspace root so bundled code finds them. */
export async function migrateDb(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: join(findWorkspaceRoot(), "packages/db/drizzle") });
}
