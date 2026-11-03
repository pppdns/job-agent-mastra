import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelV4Prompt } from "@ai-sdk/provider";
import {
  addSource,
  createDb,
  type Db,
  decideApproval,
  migrateDb,
  proposeProfileChange,
  proposeSnapshot,
  saveDraft,
  upsertJob,
} from "@copilot/db";
import { LOCAL_USER_ID } from "@copilot/shared";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it } from "vitest";
import { buildInstructions } from "./agents/copilot";
import { createChatMemory } from "./memory";

// Forced-low budget: Observational Memory compacts after ~300 tokens of history. The Observer
// is the mock model (LLM_MODE=mock), which answers in OM's <observations> format.

const THREAD = "compaction-thread";
let db: Db;
let prompts: LanguageModelV4Prompt[];

beforeEach(async () => {
  db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "compaction-")), "t.db")}`);
  await migrateDb(db);
  prompts = [];
});

function mainModel() {
  return new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      prompts.push(prompt);
      return {
        content: [{ type: "text", text: "Noted. ".repeat(20) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 40, text: 40, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}

describe("compaction (Observational Memory, forced low threshold)", () => {
  it("drops old raw messages but keeps the approved profile and pending approvals", async () => {
    // Durable state lives in app tables: an approved preference and a pending snapshot.
    const pref = await proposeProfileChange(db, {
      threadId: THREAD,
      proposal: {
        changes: [{ op: "add", kind: "hard_requirement", text: "Remote only" }],
        reason: "said so",
      },
    });
    await decideApproval(db, {
      approvalId: pref.approval.id,
      threadId: THREAD,
      decision: "approve",
      payloadHash: pref.approval.payloadHash,
    });
    const { job } = await upsertJob(db, {
      company: "Northwind Robotics",
      title: "Platform Engineer",
    });
    const { source } = await addSource(db, {
      jobId: job.id,
      kind: "pasted",
      provider: "user",
      content: "x",
    });
    await saveDraft(db, {
      jobId: job.id,
      assessment: {
        overview: "Platform role.",
        fitBasis: "with_profile",
        strengths: [{ text: "Clear scope", evidence: "official", sourceIds: [source.id] }],
        recommendation: { verdict: "consider", rationale: "Remote unclear." },
      },
    });
    const pending = (await proposeSnapshot(db, { jobId: job.id, threadId: THREAD })).approval;

    const agent = new Agent({
      id: "compaction-test",
      name: "Compaction test",
      instructions: () => buildInstructions(db, THREAD),
      model: mainModel(),
      memory: createChatMemory({ messageTokens: 300 }),
    });
    new Mastra({
      agents: { agent },
      storage: new LibSQLStore({ id: "compaction", url: ":memory:" }),
      logger: false,
    });

    const filler = "This is a long message about the job search to grow the context. ".repeat(6);
    await agent.generate(`FIRST-MESSAGE-MARKER ${filler}`, {
      memory: { thread: THREAD, resource: LOCAL_USER_ID },
    });
    for (let i = 0; i < 8; i++) {
      await agent.generate(`Turn ${i}. ${filler}`, {
        memory: { thread: THREAD, resource: LOCAL_USER_ID },
      });
    }

    const last = JSON.stringify(prompts.at(-1));
    expect(last).toContain("(mock) The user and assistant discussed"); // observations injected
    expect(last).not.toContain("FIRST-MESSAGE-MARKER"); // the oldest raw message left the context
    expect(last).toContain("Remote only"); // approved profile, from the DB
    expect(last).toContain(`[approval:${pending.id}]`); // pending approval, from the DB
  }, 60_000);
});
