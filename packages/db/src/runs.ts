import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "./index";
import {
  type NewRunEvent,
  type Run,
  type RunEvent,
  type RunStatus,
  runEvents,
  runs,
} from "./schema";
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

export type ThreadRunStatus = { status: RunStatus; endedAt: number | null };

/** Latest run per chat among the most recent runs (sidebar markers), keyed by thread id. */
export async function latestRunStatuses(
  db: Db,
  limit = 500,
): Promise<Record<string, ThreadRunStatus>> {
  const rows = await db
    .select({ threadId: runs.threadId, status: runs.status, endedAt: runs.endedAt })
    .from(runs)
    .orderBy(desc(runs.startedAt))
    .limit(limit);
  const latest: Record<string, ThreadRunStatus> = {};
  for (const row of rows) {
    latest[row.threadId] ??= { status: row.status, endedAt: row.endedAt?.getTime() ?? null };
  }
  return latest;
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

export function recordRunEvents(db: Db, events: NewRunEvent[]): Promise<void> {
  if (events.length === 0) return Promise.resolve();
  return serializeWrites(db, async () => {
    await db.insert(runEvents).values(events);
  });
}

export function setRunDetails(
  db: Db,
  id: string,
  details: Partial<Pick<Run, "model" | "traceId" | "ttftMs">>,
): Promise<void> {
  return serializeWrites(db, async () => {
    await db.update(runs).set(details).where(eq(runs.id, id));
  });
}

/** The run a background event (e.g. compaction) belongs to: the active one, else the latest. */
export async function currentOrLastRun(db: Db, threadId: string): Promise<Run | undefined> {
  return (
    (await activeRun(db, threadId)) ??
    db.query.runs.findFirst({ where: eq(runs.threadId, threadId), orderBy: desc(runs.startedAt) })
  );
}

export type UsageTotals = {
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  estimatedLlmUsd: number;
  providerCalls: Record<"search" | "extraction" | "browser", number>;
  estimatedProviderUsd: number;
  toolCalls: number;
  retries: number;
  errors: number;
  compactions: number;
};

/** Sums one row per model/provider call, so nothing is counted twice. */
export function totalsOf(events: RunEvent[]): UsageTotals {
  const t: UsageTotals = {
    llmCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    estimatedLlmUsd: 0,
    providerCalls: { search: 0, extraction: 0, browser: 0 },
    estimatedProviderUsd: 0,
    toolCalls: 0,
    retries: 0,
    errors: 0,
    compactions: 0,
  };
  for (const e of events) {
    if (e.type === "llm") {
      t.llmCalls += 1;
      t.inputTokens += e.inputTokens ?? 0;
      t.outputTokens += e.outputTokens ?? 0;
      t.cachedInputTokens += e.cachedInputTokens ?? 0;
      t.cacheWriteTokens += e.cacheWriteTokens ?? 0;
      t.reasoningTokens += e.reasoningTokens ?? 0;
      t.estimatedLlmUsd += e.estimatedUsd ?? 0;
    } else if (e.type === "provider") {
      if (e.category === "search" || e.category === "extraction" || e.category === "browser") {
        t.providerCalls[e.category] += 1;
      }
      t.estimatedProviderUsd += e.estimatedUsd ?? 0;
    } else if (e.type === "tool") t.toolCalls += 1;
    else if (e.type === "retry") t.retries += 1;
    else if (e.type === "compaction") t.compactions += 1;
    if (e.status === "error" || e.type === "error") t.errors += 1;
  }
  t.estimatedLlmUsd = Math.round(t.estimatedLlmUsd * 1e6) / 1e6;
  t.estimatedProviderUsd = Math.round(t.estimatedProviderUsd * 1e6) / 1e6;
  return t;
}

/** Runs of one chat with their events and totals, newest first, plus the chat's totals. */
export async function threadUsage(db: Db, threadId: string) {
  const threadRuns = await db.query.runs.findMany({
    where: eq(runs.threadId, threadId),
    orderBy: desc(runs.startedAt),
  });
  const events =
    threadRuns.length === 0
      ? []
      : await db.query.runEvents.findMany({
          where: inArray(
            runEvents.runId,
            threadRuns.map((r) => r.id),
          ),
          orderBy: asc(runEvents.id),
        });
  const runsWithEvents = threadRuns.map((run) => {
    const own = events.filter((e) => e.runId === run.id);
    return {
      ...run,
      durationMs: run.endedAt ? run.endedAt.getTime() - run.startedAt.getTime() : null,
      events: own,
      totals: totalsOf(own),
    };
  });
  return { runs: runsWithEvents, totals: totalsOf(events) };
}
