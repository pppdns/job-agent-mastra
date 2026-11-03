import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { findWorkspaceRoot, resolveDatabaseUrl } from "./paths";
import * as schema from "./schema";

export * from "./jobs";
export { findWorkspaceRoot, resolveDatabaseUrl } from "./paths";
export type { Job, Source, SourceKind, SourceProvider } from "./schema";
export * as schema from "./schema";

export function createDb(url: string = resolveDatabaseUrl()) {
  return drizzle(createClient({ url }), { schema });
}

export type Db = ReturnType<typeof createDb>;

/** Applies pending Drizzle migrations (idempotent). Resolved from the workspace root so bundled code finds them. */
export async function migrateDb(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: join(findWorkspaceRoot(), "packages/db/drizzle") });
}
