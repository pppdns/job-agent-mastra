import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addSource,
  currentProfile,
  decideApproval,
  findWorkspaceRoot,
  getJobDetail,
  listJobs,
  pendingProfileChanges,
  proposeProfileChange,
  resetAppTables,
  resolveDatabaseUrl,
  saveDraft,
  upsertJob,
} from "@copilot/db";
import { LOCAL_USER_ID } from "@copilot/shared";
import type { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { beforeAll, describe, expect, it } from "vitest";
import { createCopilotBaseAgent } from "../mastra/agents/copilot";
import { getAppDb } from "../mastra/app-db";
import { mastra } from "../mastra/index";
import { createChatMemory } from "../mastra/memory";
import { THREAD_CONTEXT_KEY } from "../mastra/thread-context";
import { profileSuite } from "./cases";
import { type CaseGroundTruth, caseRubricJudge, EVAL_RUN_CONTEXT_KEY, toolRuns } from "./scorers";

// Multi-chat scenarios (several turns, several chats, approvals in between) with the real
// copilot. App code plays the user's Approve click. Code checks read the DB and memory;
// `case-rubric` judges the decisive turn. Each scenario resets the eval DB first.

const listing = (file: string) =>
  readFileSync(join(findWorkspaceRoot(), "fixtures/listings", file), "utf8");

// EVAL_ONLY targets cases by name: run a scenario when "scenario" or its name matches.
const ONLY = process.env.EVAL_ONLY?.trim().toLowerCase();
const runs = (name: string) =>
  !ONLY || "scenario".includes(ONLY) || ONLY.includes("scenario") || name.includes(ONLY);

/** The copilot registered on the eval Mastra instance (storage), optionally with its own memory. */
function copilot(key: string, memory = createChatMemory()): Agent {
  const agent = createCopilotBaseAgent({ memory });
  mastra.addAgent(agent, key);
  return agent;
}

/** One user turn in a chat, as the /chat route runs it (thread in the request context). */
async function turn(agent: Agent, thread: string, text: string) {
  const requestContext = new RequestContext();
  requestContext.set(THREAD_CONTEXT_KEY, thread);
  requestContext.set(EVAL_RUN_CONTEXT_KEY, true);
  const result = await agent.generate(text, {
    memory: { thread, resource: LOCAL_USER_ID },
    requestContext,
    returnScorerData: true,
  });
  const data = result.scoringData;
  if (!data) throw new Error("no scoring data");
  const tools = toolRuns(data.output);
  console.log(
    `[${thread}] ${text.slice(0, 60)}…\n  tools: ${tools.map((t) => t.name).join(", ") || "none"}\n  reply: ${result.text}`,
  );
  return { text: result.text, tools, called: new Set(tools.map((t) => t.name)), data };
}
type Turn = Awaited<ReturnType<typeof turn>>;

/** The case rubric judge on one turn; returns its reason when it fails. */
async function rubric(t: Turn, truth: Pick<CaseGroundTruth, "must" | "mustNot">) {
  const result = await caseRubricJudge.run({
    input: t.data.input,
    output: t.data.output,
    groundTruth: truth,
  });
  return { passed: result.score === 1, reason: result.reason };
}

/** Approves every pending profile change of a chat, like the Approve button in the app. */
async function approveProfileChanges(thread: string) {
  const db = await getAppDb();
  const pending = await pendingProfileChanges(db, thread);
  for (const approval of pending) {
    const decided = await decideApproval(db, {
      approvalId: approval.id,
      threadId: thread,
      decision: "approve",
      payloadHash: approval.payloadHash,
    });
    if (!decided.ok) throw new Error(`approving failed: ${decided.error}`);
  }
  return pending.length;
}

async function seedProfile(facts = profileSuite.profile) {
  const db = await getAppDb();
  const { approval } = await proposeProfileChange(db, {
    threadId: "eval-seed",
    proposal: { changes: facts.map((f) => ({ op: "add", ...f })), reason: "Eval seed profile" },
  });
  await decideApproval(db, {
    approvalId: approval.id,
    threadId: "eval-seed",
    decision: "approve",
    payloadHash: approval.payloadHash,
  });
}

const draftsOf = (t: Turn) =>
  t.tools
    .filter((r) => r.name === "save_job_draft")
    .map((r) => (r.args as { assessment?: { fitBasis?: string } }).assessment);

async function reset() {
  if (!resolveDatabaseUrl().endsWith("/data/eval.db")) {
    throw new Error("evals must run on data/eval.db (use pnpm eval)");
  }
  await resetAppTables(await getAppDb());
}

const stamp = Date.now().toString(36);

describe.skipIf(!runs("memory across chats"))("scenario: memory across chats", () => {
  // Chat A records a local exception and proposes a lasting requirement; the user approves it.
  // Chat B must use the approved requirement and know nothing of chat A's local exception.
  const chatA = `eval-scn-memory-a-${stamp}`;
  const chatB = `eval-scn-memory-b-${stamp}`;
  const agent = copilot("evalScenarioMemory");
  let local: Turn;
  let remember: Turn;
  let assess: Turn;
  let approved = 0;

  beforeAll(async () => {
    await reset();
    local = await turn(
      agent,
      chatA,
      "For this chat only, assume I'd accept up to three office days a week if the team is in Lisbon.",
    );
    remember = await turn(
      agent,
      chatA,
      "Remember for good: I need fully remote work, or hybrid with at most one office day per week.",
    );
    approved = await approveProfileChanges(chatA);
    assess = await turn(
      agent,
      chatB,
      `Can you assess this job for me?\n\n${listing("ats-complete.md")}`,
    );
  });

  it("keeps the local exception in chat A's working memory only", async () => {
    expect(local.called.has("updateWorkingMemory")).toBe(true);
    expect(local.called.has("propose_profile_change")).toBe(false);
    const memory = await agent.getMemory();
    const wmA = await memory?.getWorkingMemory({ threadId: chatA, resourceId: LOCAL_USER_ID });
    const wmB = await memory?.getWorkingMemory({ threadId: chatB, resourceId: LOCAL_USER_ID });
    // Chat B may note the listing's office days, but no local exception of its own.
    const exceptions = (wm?: string | null) =>
      (wm ?? "").split("\n").find((l) => /local assumptions and exceptions/i.test(l)) ?? "";
    expect(exceptions(wmA)).toMatch(/three|3/i);
    expect(exceptions(wmB)).not.toMatch(/three|3|lisbon/i);
  });

  it("applies the requirement only once approved, and chat B sees it", async () => {
    expect(remember.called.has("propose_profile_change")).toBe(true);
    expect(approved).toBe(1);
    const profile = await currentProfile(await getAppDb());
    expect(profile.facts.some((f) => f.kind === "hard_requirement")).toBe(true);
    // Chat B recalls only its own messages, nothing from chat A.
    const recalled = assess.data.input.rememberedMessages;
    expect(recalled.every((m) => m.threadId === chatB)).toBe(true);
    expect(JSON.stringify(recalled)).not.toMatch(/for this chat only|remember for good/i);
    const drafts = draftsOf(assess);
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts.every((d) => d?.fitBasis === "with_profile")).toBe(true);
  });

  it("chat B judges the office days against the approved requirement (judge)", async () => {
    const r = await rubric(assess, {
      must: [
        "Treats three office days a week in Lisbon as a conflict with the user's requirement of fully remote or at most one office day per week.",
      ],
      mustNot: [
        "Says the user would accept three office days or a Lisbon hybrid role, or applies any exception the user made in another chat.",
        "Says the job fits the user's office-day requirement.",
      ],
    });
    expect(r.passed, r.reason).toBe(true);
  });
});

describe.skipIf(!runs("compaction"))(
  "scenario: compaction keeps preferences and pending actions",
  () => {
    // A low Observational Memory threshold compacts the chat after the first assessment. The
    // approved profile and this chat's pending approval come from the DB, so later turns still
    // know both even though the raw messages left the context.
    const chat = `eval-scn-compaction-${stamp}`;
    const agent = copilot("evalScenarioCompaction", createChatMemory({ messageTokens: 1_500 }));
    let propose: Turn;
    let recall: Turn;

    beforeAll(async () => {
      await reset();
      await seedProfile();
      await turn(agent, chat, `Can you assess this job for me?\n\n${listing("ats-complete.md")}`);
      propose = await turn(
        agent,
        chat,
        "Remember that my salary floor is EUR 95,000 a year. Please propose adding it to my profile.",
      );
      await turn(
        agent,
        chat,
        "What would a typical week in this role look like, from the listing?",
      );
      await turn(agent, chat, "What should I ask the recruiter about the on-call rotation?");
      recall = await turn(
        agent,
        chat,
        "Before I decide: which of my requirements does this job break, and is anything of mine still waiting for approval?",
      );
    });

    it("compacted the chat (observations exist)", async () => {
      const memory = await agent.getMemory();
      const om = await (memory as { omEngine?: Promise<unknown> } | undefined)?.omEngine;
      const observations = await (
        om as { getObservations(t: string, r?: string): Promise<string | undefined> } | null
      )?.getObservations(chat, LOCAL_USER_ID);
      expect(observations?.trim().length ?? 0).toBeGreaterThan(0);
    });

    it("left the salary floor pending, not applied", async () => {
      expect(propose.called.has("propose_profile_change")).toBe(true);
      const db = await getAppDb();
      expect(await pendingProfileChanges(db, chat)).toHaveLength(1);
      const profile = await currentProfile(db);
      expect(profile.facts.some((f) => /95/.test(f.text))).toBe(false);
    });

    it("still knows the approved requirement and the pending change (judge)", async () => {
      const r = await rubric(recall, {
        must: [
          "Names the office days (three a week in Lisbon) as breaking the user's requirement of fully remote or at most one office day per week.",
          "Says the salary floor of EUR 95,000 is still waiting for the user's approval (pending, not applied yet).",
        ],
        mustNot: [
          "Says the salary floor is already saved, approved or part of the profile.",
          "Says nothing is waiting for approval.",
        ],
      });
      expect(r.passed, r.reason).toBe(true);
    });
  },
);

describe.skipIf(!runs("stale"))("scenario: comparison with stale assessments", () => {
  // Two jobs assessed (role only) before the profile existed; the profile is approved later.
  // In a new chat, a comparison must not treat the old assessments as current personal fit.
  const chat = `eval-scn-stale-${stamp}`;
  const agent = copilot("evalScenarioStale");
  const jobs = [
    { file: "ats-complete.md", title: "Senior Platform Engineer", company: "Northwind Robotics" },
    {
      file: "remote-ambiguous.md",
      title: "Staff Backend Engineer, Payments",
      company: "Lumen Ledger",
    },
  ];
  let compare: Turn;

  beforeAll(async () => {
    await reset();
    const db = await getAppDb();
    for (const j of jobs) {
      const { job } = await upsertJob(db, { title: j.title, company: j.company });
      const { source } = await addSource(db, {
        jobId: job.id,
        kind: "pasted",
        provider: "user",
        content: listing(j.file),
      });
      await saveDraft(db, {
        jobId: job.id,
        assessment: {
          overview: `${j.title} at ${j.company}.`,
          headline: `Solid ${j.title} role`,
          fitBasis: "role_only",
          strengths: [{ text: "Clear scope", evidence: "official", sourceIds: [source.id] }],
          recommendation: { verdict: "pursue", rationale: "Strong role on paper." },
        },
      });
    }
    await seedProfile();
    expect((await listJobs(db)).every((j) => j.profileStale)).toBe(true);
    compare = await turn(
      agent,
      chat,
      "Compare my saved Northwind Robotics and Lumen Ledger jobs. Which one fits me better?",
    );
  });

  it("loads the saved jobs instead of guessing", () => {
    expect(compare.called.has("get_job") || compare.called.has("find_saved_jobs")).toBe(true);
  });

  it("any re-assessment uses the current profile", async () => {
    const drafts = draftsOf(compare);
    expect(drafts.every((d) => d?.fitBasis === "with_profile")).toBe(true);
    const db = await getAppDb();
    for (const j of await listJobs(db)) {
      const detail = await getJobDetail(db, j.id);
      if (detail?.draft?.assessment.fitBasis === "with_profile") expect(j.profileStale).toBe(false);
    }
  });

  it("flags or refreshes the stale assessments before comparing (judge)", async () => {
    const r = await rubric(compare, {
      must: [
        "Either says the saved assessments predate the user's current profile (and may need review), or re-assesses both jobs against the current profile before comparing.",
        "Treats three office days a week in Lisbon (Northwind) as a conflict with the user's requirement of at most one office day per week.",
      ],
      mustNot: [
        "Presents the old role-only verdicts ('pursue') as the user's current personal fit without any caveat.",
        "States as fact that the Lumen Ledger role can be done from Germany.",
      ],
    });
    expect(r.passed, r.reason).toBe(true);
  });
});
