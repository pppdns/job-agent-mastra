import { createDb, type Db, migrateDb } from "@copilot/db";

let ready: Promise<Db> | undefined;

/** App tables (`app_*`) in the shared database, migrated once per process on first use. */
export function getAppDb(): Promise<Db> {
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
