import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db, getDiscoveryRun, migrateDb } from "@copilot/db";
import { beforeEach, describe, expect, it } from "vitest";
import { createProgress } from "./progress";
import { claimDiscoveryRun, finishDiscovery, runDiscoverySources } from "./run";
import type { JobSource } from "./types";

let db: Db;
let runId: string;
beforeEach(async () => {
  db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "progress-")), "test.db")}`);
  await migrateDb(db);
  const claim = await claimDiscoveryRun(db, { trigger: "manual" });
  if (!claim.runId) throw new Error("no run");
  runId = claim.runId;
});

const quiet = { log: () => undefined };

describe("createProgress", () => {
  it("saves the step and source at once and work counts after flush", async () => {
    const progress = createProgress(db, runId, { ...quiet, minWriteMs: 60_000 });
    progress.step("fetch");
    progress.source("linkedin");
    progress.work(0, 3, '"AI Engineer" in Europe');
    await progress.flush();
    const run = await getDiscoveryRun(db, runId);
    expect(run?.progress).toMatchObject({
      step: "fetch",
      source: "linkedin",
      done: 0,
      total: 3,
      label: '"AI Engineer" in Europe',
    });
  });

  it("throttles work writes but keeps the latest count", async () => {
    const progress = createProgress(db, runId, { ...quiet, minWriteMs: 60_000 });
    progress.step("triage");
    for (let i = 1; i <= 20; i++) progress.work(i, 20);
    await progress.flush();
    expect((await getDiscoveryRun(db, runId))?.progress).toMatchObject({
      step: "triage",
      done: 20,
      total: 20,
    });
  });

  it("is cleared when the run ends and ignored afterwards", async () => {
    const progress = createProgress(db, runId, quiet);
    progress.step("report");
    await progress.flush();
    await finishDiscovery(db, runId, []);
    progress.step("report");
    await progress.flush();
    expect((await getDiscoveryRun(db, runId))?.progress).toBeNull();
  });
});

describe("runDiscoverySources progress", () => {
  it("reports each source and its searches", async () => {
    const seen: string[] = [];
    const source: JobSource = {
      id: "himalayas",
      paid: false,
      unavailable: () => null,
      async fetch(context) {
        context.onProgress?.(0, 2, "a");
        context.onProgress?.(1, 2, "b");
        return { postings: [], invalid: 0, costUsd: 0 };
      },
    };
    await runDiscoverySources(
      db,
      runId,
      { himalayas: source },
      {
        progress: {
          step: () => undefined,
          source: (id) => seen.push(`source:${id}`),
          work: (done, total, label) => seen.push(`${done}/${total} ${label}`),
          flush: async () => undefined,
        },
      },
    );
    expect(seen).toEqual(["source:himalayas", "0/2 a", "1/2 b"]);
  });
});
