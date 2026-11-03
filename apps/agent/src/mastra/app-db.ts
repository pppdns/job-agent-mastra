import { createDb, type Db, interruptStaleRuns, migrateDb } from "@copilot/db";

let ready: Promise<Db> | undefined;

/** App tables (`app_*`) in the shared database, migrated once per process on first use. */
export function getAppDb(): Promise<Db> {
  ready ??= (async () => {
    const db = createDb();
    await migrateDb(db);
    // This process is the only one running chat runs: earlier "running" rows are orphans.
    await interruptStaleRuns(db);
    return db;
  })().catch((error) => {
    ready = undefined;
    throw error;
  });
  return ready;
}
