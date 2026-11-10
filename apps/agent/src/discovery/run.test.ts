import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDb,
  type Db,
  finishDiscoveryRun,
  getDiscoveryRun,
  listJobs,
  migrateDb,
  recordSourceResult,
  saveSearchSettings,
  startDiscoveryRun,
} from "@copilot/db";
import {
  DEFAULT_SEARCH_SETTINGS,
  type DiscoverySource,
  type PostingInput,
  type SearchSettings,
} from "@copilot/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { claimDiscoveryRun, finishDiscovery, runDiscoverySources } from "./run";
import type { FetchContext, JobSource } from "./types";

let db: Db;
beforeEach(async () => {
  db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "discover-")), "test.db")}`);
  await migrateDb(db);
});

const now = new Date();

const posting = (source: DiscoverySource, over: Partial<PostingInput> = {}): PostingInput => ({
  source,
  externalId: `${source}-1`,
  url: `https://example.com/${source}/1`,
  applyUrl: null,
  title: "Founding Engineer",
  company: "Quillfeather Health",
  location: null,
  remote: null,
  regions: [],
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
  salaryText: null,
  seniority: null,
  employmentType: null,
  postedAt: new Date(now.getTime() - 86_400_000),
  description: "Build it.",
  ...over,
});

type Stub = JobSource & { contexts: FetchContext[] };

function stub(
  id: DiscoverySource,
  behaviour: (c: FetchContext) => Promise<{ postings: PostingInput[]; costUsd?: number }>,
  options: { paid?: boolean; unavailable?: string } = {},
): Stub {
  const contexts: FetchContext[] = [];
  return {
    id,
    paid: options.paid ?? id === "linkedin",
    unavailable: () => options.unavailable ?? null,
    contexts,
    async fetch(c) {
      contexts.push(c);
      const r = await behaviour(c);
      return { postings: r.postings, invalid: 0, costUsd: r.costUsd ?? 0 };
    },
  };
}

async function run(sources: Partial<Record<DiscoverySource, JobSource>>, lookbackDays?: number) {
  const claim = await claimDiscoveryRun(db, { trigger: "manual", lookbackDays });
  if (!claim.runId) throw new Error("not claimed");
  const results = await runDiscoverySources(db, claim.runId, sources);
  await finishDiscovery(db, claim.runId, results);
  return { runId: claim.runId, results };
}

const saveSettings = (over: Partial<SearchSettings>) =>
  saveSearchSettings(db, { ...DEFAULT_SEARCH_SETTINGS, ...over });

describe("runDiscoverySources", () => {
  it("stores, screens and dedupes postings from every source, counting outcomes", async () => {
    const himalayas = stub("himalayas", async () => ({
      postings: [
        posting("himalayas"),
        posting("himalayas", { externalId: "h-2", title: "Sales Engineer", company: "Kite" }),
      ],
    }));
    const linkedin = stub("linkedin", async () => ({
      postings: [posting("linkedin", { company: "Quillfeather Health GmbH" })],
      costUsd: 0.02,
    }));
    const { runId, results } = await run({ himalayas, linkedin });
    expect(results).toMatchObject([
      { source: "himalayas", status: "ok", fetched: 2, newJobs: 1, filtered: 1, merged: 0 },
      { source: "linkedin", status: "ok", fetched: 1, newJobs: 0, merged: 1, costUsd: 0.02 },
    ]);
    expect(await listJobs(db)).toHaveLength(1);
    expect(await getDiscoveryRun(db, runId)).toMatchObject({
      status: "completed",
      estimatedUsd: 0.02,
    });
  });

  it("keeps going when one source fails, and fails the run only when all do", async () => {
    const boom = stub("linkedin", async () => {
      throw new Error("Apify run run1 failed");
    });
    const ok = stub("himalayas", async () => ({ postings: [posting("himalayas")] }));
    const first = await run({ himalayas: ok, linkedin: boom });
    expect(first.results.map((r) => r.status)).toEqual(["ok", "failed"]);
    expect((await getDiscoveryRun(db, first.runId))?.status).toBe("completed");

    const alsoBoom = stub("himalayas", async () => {
      throw new Error("down");
    });
    const second = await run({ himalayas: alsoBoom, linkedin: boom });
    expect((await getDiscoveryRun(db, second.runId))?.status).toBe("failed");
  });

  it("skips sources that are off, unavailable, or over the monthly Apify budget", async () => {
    await saveSettings({
      sources: { ...DEFAULT_SEARCH_SETTINGS.sources, himalayas: { enabled: false, maxPages: 1 } },
      apifyMonthlyBudgetUsd: 1,
    });
    const earlier = await startDiscoveryRun(db, { trigger: "schedule" });
    await recordSourceResult(db, earlier?.id ?? "", {
      source: "linkedin",
      status: "ok",
      fetched: 1,
      invalid: 0,
      seen: 0,
      filtered: 0,
      newJobs: 1,
      merged: 0,
      costUsd: 1,
      durationMs: 1,
    });
    await finishDiscoveryRun(db, earlier?.id ?? "", "completed");
    const linkedin = stub("linkedin", async () => ({ postings: [] }));
    const { results } = await run({
      himalayas: stub("himalayas", async () => ({ postings: [] })),
      linkedin,
    });
    expect(results).toMatchObject([
      { source: "himalayas", status: "skipped", message: "turned off in search settings" },
      { source: "linkedin", status: "skipped", message: expect.stringContaining("budget") },
    ]);
    expect(linkedin.contexts).toHaveLength(0);

    const missingKey = stub("linkedin", async () => ({ postings: [] }), {
      unavailable: "APIFY_API_KEY is not set",
    });
    await saveSettings({});
    const again = await run({
      himalayas: stub("himalayas", async () => ({ postings: [] })),
      linkedin: missingKey,
    });
    expect(again.results[1]).toMatchObject({
      status: "skipped",
      message: "APIFY_API_KEY is not set",
    });
  });

  it("continues from the last good run, or looks back the backfill window with raised caps", async () => {
    const himalayas = stub("himalayas", async () => ({ postings: [] }));
    const linkedin = stub("linkedin", async () => ({ postings: [] }));
    await run({ himalayas, linkedin });
    const firstSince = himalayas.contexts[0]?.since.getTime() ?? 0;
    expect(Date.now() - firstSince).toBeGreaterThan(13 * 86_400_000);

    await run({ himalayas, linkedin });
    const secondSince = himalayas.contexts[1]?.since.getTime() ?? 0;
    expect(Date.now() - secondSince).toBeLessThan(2 * 3_600_000);
    expect(linkedin.contexts[1]?.maxUsd).toBeCloseTo(0.5);

    await run({ himalayas, linkedin }, 30);
    const backfill = himalayas.contexts[2];
    expect(backfill?.backfill).toBe(true);
    expect(Date.now() - (backfill?.since.getTime() ?? 0)).toBeGreaterThan(29 * 86_400_000);
    expect(linkedin.contexts[2]?.maxUsd).toBeCloseTo(2);
  });

  it("passes known board ids so paid sources can skip them", async () => {
    const first = stub("linkedin", async () => ({ postings: [posting("linkedin")] }));
    const none = stub("himalayas", async () => ({ postings: [] }));
    await run({ himalayas: none, linkedin: first });
    await run({ himalayas: none, linkedin: first });
    expect(first.contexts[1]?.knownIds).toEqual(["linkedin-1"]);
  });

  it("refuses a second run while one is running", async () => {
    expect((await claimDiscoveryRun(db, { trigger: "manual" })).runId).not.toBeNull();
    expect(await claimDiscoveryRun(db, { trigger: "schedule" })).toEqual({
      runId: null,
      skipped: "another discovery run is running",
    });
  });
});
