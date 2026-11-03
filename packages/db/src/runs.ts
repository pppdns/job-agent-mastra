import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./index";
import { type Run, type RunStatus, runs } from "./schema";
import { serializeWrites } from "./write-lock";

export function startRun(db: Db, input: { id: string; threadId: string }): Promise<Run> {
  return serializeWrites(db, async () => {
    const [row] = await db
      .insert(runs)
      .values({ id: input.id, threadId: input.threadId, status: "running", startedAt: new Date() })
      .returning();
    if (!row) throw new Error("run insert returned no row");
    return row;
  });
}

/** Ends a running run; a run that already ended keeps its first final status. */
export function endRun(
  db: Db,
  id: string,
  status: Exclude<RunStatus, "running">,
  error?: string,
): Promise<void> {
  return serializeWrites(db, async () => {
    await db
      .update(runs)
      .set({ status, error: error?.slice(0, 500) ?? null, endedAt: new Date() })
      .where(and(eq(runs.id, id), eq(runs.status, "running")));
  });
}

export async function activeRun(db: Db, threadId: string): Promise<Run | undefined> {
  return db.query.runs.findFirst({
    where: and(eq(runs.threadId, threadId), eq(runs.status, "running")),
    orderBy: desc(runs.startedAt),
  });
}

/**
 * Runs left "running" by a previous process can't be observed (the replay cache was in
 * memory): mark them interrupted at startup. Partial results (claims, drafts) stay.
 */
export function interruptStaleRuns(db: Db): Promise<number> {
  return serializeWrites(db, async () => {
    const rows = await db
      .update(runs)
      .set({ status: "interrupted", endedAt: new Date() })
      .where(eq(runs.status, "running"))
      .returning({ id: runs.id });
    return rows.length;
  });
}
