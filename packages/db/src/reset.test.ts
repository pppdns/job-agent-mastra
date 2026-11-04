import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { createDb, migrateDb, resetAppTables } from "./index";
import { searchJobIds, upsertJob } from "./jobs";
import { currentProfile, decideApproval, proposeProfileChange } from "./profile";

it("resetAppTables empties app tables, search included, and keeps other tables", async () => {
  const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "reset-")), "test.db")}`);
  await migrateDb(db);
  await db.run(sql`create table mastra_keep (id text)`);
  await db.run(sql`insert into mastra_keep values ('x')`);
  await upsertJob(db, { company: "Acme", title: "Engineer" });
  const { approval } = await proposeProfileChange(db, {
    threadId: "t",
    proposal: {
      changes: [{ op: "add", kind: "background", text: "Lives in Berlin" }],
      reason: "User said so",
    },
  });
  await decideApproval(db, {
    approvalId: approval.id,
    threadId: "t",
    decision: "approve",
    payloadHash: approval.payloadHash,
  });

  await resetAppTables(db);

  expect(await currentProfile(db)).toEqual({ version: 0, facts: [] });
  expect(await searchJobIds(db, "acme")).toEqual([]);
  expect(await db.all(sql`select * from mastra_keep`)).toHaveLength(1);
  // Still usable afterwards.
  expect((await upsertJob(db, { company: "Acme", title: "Engineer" })).job.id).toBeTruthy();
});
