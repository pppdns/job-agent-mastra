import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db, migrateDb } from "./index";
import {
  activeRun,
  endRun,
  interruptStaleRuns,
  latestRunStatuses,
  recordRunEvents,
  startRun,
  threadUsage,
} from "./runs";

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

  it("reports the latest run per chat", async () => {
    await startRun(db, { id: "a1", threadId: "a" });
    await endRun(db, "a1", "failed");
    await new Promise((r) => setTimeout(r, 5));
    await startRun(db, { id: "a2", threadId: "a" });
    await startRun(db, { id: "b1", threadId: "b" });
    await endRun(db, "b1", "completed");
    const latest = await latestRunStatuses(db);
    expect(latest.a).toEqual({ status: "running", endedAt: null });
    expect(latest.b?.status).toBe("completed");
    expect(latest.b?.endedAt).toBeTypeOf("number");
  });

  it("keeps a quiet chat's latest run however many runs a busy chat has", async () => {
    await startRun(db, { id: "q1", threadId: "quiet" });
    await endRun(db, "q1", "completed");
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 2));
      await startRun(db, { id: `busy${i}`, threadId: "busy" });
    }
    const latest = await latestRunStatuses(db, 2);
    expect(Object.keys(latest).sort()).toEqual(["busy", "quiet"]);
    expect(latest.quiet?.status).toBe("completed");
    expect(Object.keys(await latestRunStatuses(db, 1))).toEqual(["busy"]);
  });

  it("marks runs left running by a previous process as interrupted", async () => {
    await startRun(db, { id: "r1", threadId: "t" });
    expect(await interruptStaleRuns(db)).toBe(1);
    expect(await activeRun(db, "t")).toBeUndefined();
  });

  it("sums one row per call into run and chat totals", async () => {
    await startRun(db, { id: "r1", threadId: "t" });
    await startRun(db, { id: "r2", threadId: "t" });
    const at = new Date();
    await recordRunEvents(db, [
      {
        runId: "r1",
        type: "llm",
        category: "llm",
        name: "m",
        actor: "copilot",
        status: "ok",
        at,
        inputTokens: 100,
        outputTokens: 10,
        cachedInputTokens: 60,
        estimatedUsd: 0.001,
      },
      {
        runId: "r1",
        type: "llm",
        category: "llm",
        name: "m",
        actor: "researcher",
        status: "ok",
        at,
        inputTokens: 50,
        outputTokens: 5,
        estimatedUsd: 0.0005,
      },
      {
        runId: "r1",
        type: "provider",
        category: "search",
        name: "tavily.search",
        status: "ok",
        at,
        estimatedUsd: 0.008,
      },
      { runId: "r1", type: "tool", category: "app", name: "research_company", status: "ok", at },
      {
        runId: "r2",
        type: "provider",
        category: "extraction",
        name: "tavily.extract",
        status: "error",
        at,
        estimatedUsd: 0,
      },
      {
        runId: "r2",
        type: "compaction",
        category: "memory",
        name: "observation",
        status: "ok",
        at,
      },
    ]);
    const usage = await threadUsage(db, "t");
    const r1 = usage.runs.find((r) => r.id === "r1");
    expect(r1?.totals).toMatchObject({
      llmCalls: 2,
      inputTokens: 150,
      outputTokens: 15,
      cachedInputTokens: 60,
      estimatedLlmUsd: 0.0015,
      providerCalls: { search: 1, extraction: 0 },
      toolCalls: 1,
    });
    expect(usage.totals).toMatchObject({
      llmCalls: 2,
      providerCalls: { search: 1, extraction: 1 },
      errors: 1,
      compactions: 1,
      estimatedProviderUsd: 0.008,
    });
  });
});
