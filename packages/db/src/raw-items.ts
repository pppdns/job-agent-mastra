import { randomUUID } from "node:crypto";
import type { DiscoverySource } from "@copilot/shared";
import { and, desc, eq, lt } from "drizzle-orm";
import type { Db } from "./index";
import { type RawItem, rawItems } from "./schema";
import { serializeWrites } from "./write-lock";

// Raw provider items kept per discovery run (see `rawItems` in schema.ts): enough to replay a
// parser against real output after a board changes its fields, without storing whole feeds.

export const RAW_ITEM_RETENTION_DAYS = 60;
/** Larger items are stored as their top-level keys and size only. */
export const MAX_RAW_ITEM_CHARS = 50_000;

const payloadOf = (item: unknown) => {
  let json: string;
  try {
    json = JSON.stringify(item) ?? "null";
  } catch {
    return JSON.stringify({ unserializable: true });
  }
  if (json.length <= MAX_RAW_ITEM_CHARS) return json;
  const keys = item && typeof item === "object" ? Object.keys(item).slice(0, 200) : [];
  return JSON.stringify({ oversized: true, chars: json.length, keys });
};

export function recordRawItems(
  db: Db,
  input: {
    runId: string;
    source: DiscoverySource;
    invalid: unknown[];
    sample: unknown[];
    now?: Date;
  },
): Promise<number> {
  const createdAt = input.now ?? new Date();
  const rows = [
    ...input.invalid.map((item) => ({ kind: "invalid" as const, item })),
    ...input.sample.map((item) => ({ kind: "sample" as const, item })),
  ].map(({ kind, item }) => ({
    id: randomUUID(),
    runId: input.runId,
    source: input.source,
    kind,
    payload: payloadOf(item),
    createdAt,
  }));
  if (rows.length === 0) return Promise.resolve(0);
  return serializeWrites(db, async () => {
    await db.insert(rawItems).values(rows);
    return rows.length;
  });
}

/** Deletes raw items older than the retention window. */
export function pruneRawItems(db: Db, now: Date = new Date()): Promise<number> {
  const before = new Date(now.getTime() - RAW_ITEM_RETENTION_DAYS * 86_400_000);
  return serializeWrites(db, async () => {
    const deleted = await db
      .delete(rawItems)
      .where(lt(rawItems.createdAt, before))
      .returning({ id: rawItems.id });
    return deleted.length;
  });
}

/** Stored raw items of one source, newest first (for replaying a parser). */
export async function rawItemsOf(
  db: Db,
  source: DiscoverySource,
  options: { kind?: RawItem["kind"]; limit?: number } = {},
): Promise<{ runId: string; kind: RawItem["kind"]; createdAt: Date; item: unknown }[]> {
  const rows = await db
    .select()
    .from(rawItems)
    .where(
      options.kind
        ? and(eq(rawItems.source, source), eq(rawItems.kind, options.kind))
        : eq(rawItems.source, source),
    )
    .orderBy(desc(rawItems.createdAt))
    .limit(options.limit ?? 500);
  return rows.map((r) => ({
    runId: r.runId,
    kind: r.kind,
    createdAt: r.createdAt,
    item: JSON.parse(r.payload),
  }));
}
