import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db, migrateDb } from "./index";
import { activeRun, endRun, interruptStaleRuns, startRun } from "./runs";

let db: Db;
beforeEach(async () => {
  db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "runs-")), "t.db")}`);
  await migrateDb(db);
});

describe("runs", () => {
  it("tracks the active run per thread and keeps the first final status", async () => {
    await startRun(db, { id: "r1", threadId: "t" });
    expect((await activeRun(db, "t"))?.id).toBe("r1");
    await endRun(db, "r1", "cancelled");
    await endRun(db, "r1", "completed");
    expect(await activeRun(db, "t")).toBeUndefined();
    expect((await db.query.runs.findFirst())?.status).toBe("cancelled");
  });

  it("marks runs left running by a previous process as interrupted", async () => {
    await startRun(db, { id: "r1", threadId: "t" });
    expect(await interruptStaleRuns(db)).toBe(1);
    expect(await activeRun(db, "t")).toBeUndefined();
  });
});
