import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  decideApproval,
  findWorkspaceRoot,
  proposeProfileChange,
  resetAppTables,
  resolveDatabaseUrl,
} from "@copilot/db";
import { COPILOT_AGENT_ID } from "@copilot/shared";
import type { ItemWithScores } from "@mastra/core/datasets";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../env";
import { getAppDb } from "../mastra/app-db";
import { mastra } from "../mastra/index";
import { EVAL_SUITES, type EvalCase, type EvalSuite } from "./cases";
import { allScorers, EVAL_RUN_CONTEXT_KEY } from "./scorers";

/** Scores that must be 1 on every item where they apply (not scorable = doesn't apply). */
const GATES = [
  allScorers.caseExpectations.id,
  allScorers.caseRubric.id,
  allScorers.draftAfterListing.id,
  allScorers.roleOnlyWithoutProfile.id,
  allScorers.noToolErrors.id,
];
const QUALITY = allScorers.copilotQuality.id;
const QUALITY_THRESHOLD = 0.8;

// Ad hoc runs: EVAL_ONLY=<name substring> picks cases, EVAL_REPEAT=<n> runs each n times
// (for flaky behaviour). They use a separate "-adhoc" dataset, so the main ones keep their history.
const ONLY = process.env.EVAL_ONLY?.trim().toLowerCase();
const REPEAT = Math.max(1, Math.floor(Number(process.env.EVAL_REPEAT ?? 1)) || 1);
const ADHOC = Boolean(ONLY) || REPEAT > 1;

/** One dataset item: a case, repeated under distinct keys when EVAL_REPEAT > 1. */
type CaseRun = { key: string; case: EvalCase };
const runsOf = (suite: EvalSuite): CaseRun[] =>
  suite.cases
    .filter((c) => !ONLY || c.name.toLowerCase().includes(ONLY))
    .flatMap((c) =>
      Array.from({ length: REPEAT }, (_, i) => ({
        key: REPEAT > 1 ? `${c.name} #${i + 1}` : c.name,
        case: c,
      })),
    );
const SUITES = EVAL_SUITES.map((suite) => ({ suite, runs: runsOf(suite) })).filter(
  (s) => s.runs.length > 0,
);

const SEED_THREAD = "eval-seed";
const report: string[] = [];

/** Approves the suite's profile facts through the normal proposal → decision path. */
async function seedProfile(suite: EvalSuite) {
  if (suite.profile.length === 0) return;
  const db = await getAppDb();
  const { approval } = await proposeProfileChange(db, {
    threadId: SEED_THREAD,
    proposal: {
      changes: suite.profile.map((f) => ({ op: "add", ...f })),
      reason: "Eval seed profile",
    },
  });
  const decided = await decideApproval(db, {
    approvalId: approval.id,
    threadId: SEED_THREAD,
    decision: "approve",
    payloadHash: approval.payloadHash,
  });
  if (!decided.ok) throw new Error(`seeding the profile failed: ${decided.error}`);
}

/** The suite's dataset, with its items replaced when the cases changed (a new dataset version). */
async function syncDataset(suite: EvalSuite, runs: CaseRun[]) {
  const items = runs.map((r) => ({
    input: r.case.input,
    groundTruth: r.case.groundTruth,
    metadata: { case: r.key },
  }));
  const id = ADHOC ? `${suite.id}-adhoc` : suite.id;
  const hash = createHash("sha256").update(JSON.stringify(items)).digest("hex").slice(0, 16);
  const dataset = await mastra.datasets.get({ id }).catch(() =>
    mastra.datasets.create({
      id,
      name: ADHOC ? `${suite.name} (ad hoc)` : suite.name,
      description: suite.description,
    }),
  );
  const details = await dataset.getDetails();
  if (details.metadata?.casesHash === hash) return dataset;
  const existing = await dataset.listItems({ page: 0, perPage: 500 });
  const ids = (Array.isArray(existing) ? existing : existing.items).map((i) => i.id);
  if (ids.length) await dataset.deleteItems({ itemIds: ids });
  await dataset.addItems({ items });
  await dataset.update({ metadata: { casesHash: hash } });
  return dataset;
}

const scoreOf = (item: ItemWithScores, id: string) => item.scores.find((s) => s.scorerId === id);
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toFixed(2));

describe.each(SUITES)("$suite.name", ({ suite, runs }) => {
  const results = new Map<string, ItemWithScores>();

  beforeAll(async () => {
    // Never wipe the dev database: only the file vitest.eval.config.ts points at.
    if (!resolveDatabaseUrl().endsWith("/data/eval.db")) {
      throw new Error("evals must run on data/eval.db (use pnpm eval)");
    }
    await resetAppTables(await getAppDb());
    await seedProfile(suite);
    const dataset = await syncDataset(suite, runs);
    const summary = await dataset.startExperiment({
      name: `${env.COPILOT_MODEL} · judge ${env.EVAL_JUDGE_MODEL}`,
      metadata: { copilotModel: env.COPILOT_MODEL, judgeModel: env.EVAL_JUDGE_MODEL },
      targetType: "agent",
      targetId: COPILOT_AGENT_ID,
      scorers: [...GATES, QUALITY],
      requestContext: { [EVAL_RUN_CONTEXT_KEY]: true },
      maxConcurrency: 3,
      itemTimeout: 10 * 60_000,
    });
    for (const item of summary.results) {
      const name = item.metadata?.case;
      if (typeof name === "string") results.set(name, item);
    }

    report.push(
      `### ${suite.name}`,
      "",
      `Experiment \`${summary.experimentId}\` (${summary.status}), dataset \`${dataset.id}\`.`,
      "",
      "| Case | Expectations | Rubric | Quality | Seconds | Notes |",
      "| --- | --- | --- | --- | --- | --- |",
      ...runs.map(({ key }) => {
        const item = results.get(key);
        if (!item) return `| ${key} | – | – | – | – | missing result |`;
        const seconds = (item.completedAt.getTime() - item.startedAt.getTime()) / 1000;
        const failed = item.scores.filter((s) => s.error || (s.score !== null && s.score < 1));
        const notes = [
          item.error?.message,
          ...failed.map((s) => `${s.scorerId}: ${s.error ?? s.reason ?? ""}`),
        ]
          .filter(Boolean)
          .join(" · ")
          .replaceAll("|", "/")
          .replaceAll("\n", " ");
        return `| ${key} | ${fmt(scoreOf(item, allScorers.caseExpectations.id)?.score)} | ${fmt(scoreOf(item, allScorers.caseRubric.id)?.score)} | ${fmt(scoreOf(item, QUALITY)?.score)} | ${seconds.toFixed(0)} | ${notes} |`;
      }),
      "",
    );
  });

  it.each(runs)("$key", ({ key }) => {
    const item = results.get(key);
    expect(item, "no experiment result").toBeDefined();
    if (!item) return;
    expect(item.error?.message ?? null, "agent run failed").toBeNull();
    for (const id of GATES) {
      const score = scoreOf(item, id);
      if (!score || score.notScorable) continue;
      expect(score.error, `${id} errored`).toBeNull();
      expect(score.score, `${id}: ${score.reason}`).toBe(1);
    }
  });

  it(`average ${QUALITY} ≥ ${QUALITY_THRESHOLD}`, () => {
    const scores = [...results.values()]
      .map((i) => scoreOf(i, QUALITY)?.score)
      .filter((s): s is number => typeof s === "number");
    expect(scores.length).toBeGreaterThan(0);
    const average = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(average).toBeGreaterThanOrEqual(QUALITY_THRESHOLD);
  });
});

afterAll(() => {
  const header = [
    "# Eval report",
    "",
    `${new Date().toISOString()} · copilot \`${env.COPILOT_MODEL}\` · judge \`${env.EVAL_JUDGE_MODEL}\` · web fixtures`,
    "",
    "Scores: 1 = pass. Expectations = required/forbidden tools and fit basis (code); Rubric = case must/mustNot (judge); Quality = generic rubric (judge, share of criteria passed). Traces: Studio → Datasets → Experiments.",
    "",
  ];
  const text = [...header, ...report].join("\n");
  writeFileSync(join(findWorkspaceRoot(), "data/eval-report.md"), text);
  console.log(text);
});
