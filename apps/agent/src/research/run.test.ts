import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db, migrateDb, upsertJob } from "@copilot/db";
import { beforeEach, describe, expect, it } from "vitest";
import type { Resolver } from "../ingest/url-guard";
import { createFixtureWebProviders } from "../web/fixture-providers";
import { RetryableError } from "../web/retry";
import { runResearch } from "./run";
import type { ProgressEvent } from "./tools";

// Mock model (LLM_MODE=mock): search the company, read the top result, record one claim.
const resolve: Resolver = async () => ["93.184.216.34"];
const limits = { maxToolCalls: 12, maxMs: 60_000, maxUsd: 1 };

let db: Db;
let jobId: string;
let events: ProgressEvent[];

beforeEach(async () => {
  db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "research-")), "t.db")}`);
  await migrateDb(db);
  jobId = (await upsertJob(db, { company: "Northwind Robotics", title: "Platform Engineer" })).job
    .id;
  events = [];
});

const deps = (over = {}) => ({
  db,
  web: createFixtureWebProviders(),
  resolve,
  limits,
  emit: async (e: ProgressEvent) => {
    events.push(e);
  },
  ...over,
});

describe("runResearch", () => {
  it("records sourced claims and streams real progress", async () => {
    const result = await runResearch({ jobId, topics: ["business"], questions: [] }, deps());
    expect(result).toMatchObject({ status: "completed", company: "Northwind Robotics" });
    if (result.status !== "completed") return;
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.sourceIds).toHaveLength(1);
    expect(result.budget).toMatchObject({ toolCalls: 2, limitedBy: null });
    expect(events.map((e) => e.kind)).toEqual(["start", "search", "read", "claim", "done"]);
  });

  it("stops cleanly when the budget is exhausted and keeps partial results", async () => {
    const result = await runResearch(
      { jobId, topics: ["business"], questions: [] },
      deps({ limits: { ...limits, maxToolCalls: 1 } }),
    );
    expect(result).toMatchObject({ status: "budget_limited", claims: [] });
    expect(events.map((e) => e.kind)).toEqual(["start", "search", "budget_limited", "done"]);
  });

  it("reports cancellation when the parent run is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runResearch(
      { jobId, topics: ["business"], questions: [] },
      deps({ signal: controller.signal }),
    );
    expect(result).toMatchObject({ status: "cancelled" });
  });

  it("is unavailable without web providers or a company", async () => {
    expect(
      await runResearch({ jobId, topics: ["business"], questions: [] }, deps({ web: null })),
    ).toMatchObject({
      status: "unavailable",
    });
  });

  it("retries a transient read failure and reports the retry as progress", async () => {
    const web = createFixtureWebProviders();
    let failures = 1;
    const flaky = {
      ...web,
      extract: async (...args: Parameters<typeof web.extract>) => {
        if (failures-- > 0) throw new RetryableError("tavily extract failed with 503");
        return web.extract(...args);
      },
    };
    const result = await runResearch(
      { jobId, topics: ["business"], questions: [] },
      deps({ web: flaky }),
    );
    expect(result).toMatchObject({ status: "completed" });
    expect(events.map((e) => e.kind)).toEqual([
      "start",
      "search",
      "retry",
      "read",
      "claim",
      "done",
    ]);
  });
});
