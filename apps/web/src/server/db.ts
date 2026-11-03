import "server-only";
import { createDb, type Db, migrateDb } from "@copilot/db";

let ready: Promise<Db> | undefined;

/** App tables in the shared database (same file as the agent). Migrated once per process. */
export function appDb(): Promise<Db> {
  ready ??= (async () => {
    const db = createDb();
    await migrateDb(db);
    return db;
  })().catch((error) => {
    ready = undefined;
    throw error;
  });
  return ready;
}
