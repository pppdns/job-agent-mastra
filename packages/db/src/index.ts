import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { resolveDatabaseUrl } from "./paths";
import * as schema from "./schema";

export { findWorkspaceRoot, resolveDatabaseUrl } from "./paths";
export * as schema from "./schema";

export function createDb(url: string = resolveDatabaseUrl()) {
  return drizzle(createClient({ url }), { schema });
}

export type Db = ReturnType<typeof createDb>;
