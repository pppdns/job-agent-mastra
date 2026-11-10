import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { startDiscoveryRun } from "./discovery";
import { createDb, type Db, migrateDb } from "./index";
import { MAX_RAW_ITEM_CHARS, pruneRawItems, rawItemsOf, recordRawItems } from "./raw-items";

let db: Db;
beforeEach(async () => {
  db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "raw-")), "test.db")}`);
  await migrateDb(db);
});

describe("raw items", () => {
  it("stores invalid and sample items, shrinks oversized ones, and prunes old ones", async () => {
    const run = await startDiscoveryRun(db, { trigger: "manual" });
    const runId = run?.id ?? "";
    const old = new Date("2026-08-01T00:00:00Z");
    await recordRawItems(db, { runId, source: "dice", invalid: [{ id: 1 }], sample: [], now: old });
    const big = { id: 2, description: "x".repeat(MAX_RAW_ITEM_CHARS) };
    expect(
      await recordRawItems(db, { runId, source: "dice", invalid: [big], sample: [{ id: 3 }] }),
    ).toBe(2);

    const items = await rawItemsOf(db, "dice");
    expect(items.map((i) => [i.kind, i.item])).toEqual([
      ["invalid", { oversized: true, chars: expect.any(Number), keys: ["id", "description"] }],
      ["sample", { id: 3 }],
      ["invalid", { id: 1 }],
    ]);
    expect(await rawItemsOf(db, "dice", { kind: "sample" })).toHaveLength(1);
    expect(await pruneRawItems(db, new Date("2026-11-10T00:00:00Z"))).toBe(1);
    expect(await rawItemsOf(db, "dice")).toHaveLength(2);
  });
});
