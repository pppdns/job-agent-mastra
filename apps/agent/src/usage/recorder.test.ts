import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db, migrateDb, startRun, threadUsage } from "@copilot/db";
import { beforeEach, describe, expect, it } from "vitest";
import { recordChunk } from "../mastra/routes/chat";
import { createFixtureWebProviders } from "../web/fixture-providers";
import { meterWeb, RunRecorder } from "./recorder";

let db: Db;
beforeEach(async () => {
  db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "rec-")), "t.db")}`);
  await migrateDb(db);
});

describe("RunRecorder", () => {
  it("records one event per model step, tool call and provider call", async () => {
    const recorder = new RunRecorder(db, "thread");
    // Chunks can arrive before the run id is known; they are buffered.
    recordChunk(recorder, {
      type: "tool-call",
      payload: { toolCallId: "c1", toolName: "ingest_listing" },
    });
    await startRun(db, { id: "run1", threadId: "thread" });
    recorder.attach("run1");
    recordChunk(recorder, {
      type: "tool-result",
      payload: {
        toolCallId: "c1",
        toolName: "ingest_listing",
        args: { url: "https://x.example" },
        result: { status: "blocked", reason: "private" },
      },
    });
    recordChunk(recorder, {
      type: "step-finish",
      payload: {
        output: { usage: { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 800 } },
      },
    });
    recordChunk(recorder, { type: "text-delta", payload: { text: "hi" } });
    recordChunk(recorder, {
      type: "step-finish",
      payload: { output: { usage: { inputTokens: 1200, outputTokens: 50 } } },
    });
    recordChunk(recorder, { type: "data-om-activation", payload: {} });

    const web = meterWeb(createFixtureWebProviders(), recorder, "researcher");
    await web.search("northwind robotics", { maxResults: 3 });
    await web.extract("https://northwind-robotics.example/about", "basic");
    await web.extract("https://missing.example/", "basic");
    await recorder.flush();

    const { runs, totals } = await threadUsage(db, "thread");
    expect(runs[0]?.events.map((e) => `${e.type}:${e.name}:${e.status}`)).toEqual([
      "tool:ingest_listing:error",
      "llm:anthropic/claude-sonnet-5.5:ok",
      "llm:anthropic/claude-sonnet-5.5:ok",
      "compaction:activation:ok",
      "provider:tavily.search:ok",
      "provider:tavily.extract:ok",
      "provider:tavily.extract:error",
    ]);
    expect(totals).toMatchObject({
      llmCalls: 2,
      inputTokens: 2200,
      outputTokens: 150,
      cachedInputTokens: 800,
      providerCalls: { search: 1, extraction: 2, browser: 0 },
      toolCalls: 1,
      compactions: 1,
    });
    // 200 plain × $2 + 800 cached × $0.20 + 150 out × $10, per million; then 1200 × $2 + 50 × $10
    expect(totals.estimatedLlmUsd).toBeCloseTo(
      (200 * 2 + 800 * 0.2 + 100 * 10 + 1200 * 2 + 50 * 10) / 1e6,
      8,
    );
    expect(recorder.firstTextAt).not.toBeNull();
  });
});
