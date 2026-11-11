import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStorage, evalDatasetDomains } from "./storage";

describe("createStorage", () => {
  it("keeps memory in libSQL and puts observability in DuckDB", async () => {
    const { storage } = createStorage({ DATABASE_URL: ":memory:" });
    await storage.init();
    const observability = await storage.getStore("observability");
    expect(observability?.constructor.name).toMatch(/DuckDB/);
    expect((await storage.getStore("memory"))?.constructor.name).toMatch(/LibSQL/);
  });
});

describe("pruneObservability", () => {
  it("deletes spans past the retention age and keeps recent ones", async () => {
    const { storage, pruneObservability } = createStorage({ DATABASE_URL: ":memory:" });
    await storage.init();
    const observability = await storage.getStore("observability");
    if (!observability) throw new Error("no observability store");
    const span = (traceId: string, at: Date) => ({
      traceId,
      spanId: `${traceId}-root`,
      parentSpanId: null,
      name: "run",
      spanType: "agent_run",
      isEvent: false,
      startedAt: at,
      endedAt: at,
    });
    const old = new Date(Date.now() - 8 * 86_400_000);
    await observability.batchCreateSpans({
      records: [span("old", old), span("new", new Date())] as never,
    });
    const results = await pruneObservability();
    expect(results.find((r) => r.table.includes("span"))?.deleted).toBeGreaterThan(0);
    expect((await observability.getTrace({ traceId: "new" }))?.spans.length).toBe(1);
  });
});

describe("evalDatasetDomains", () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });
  const workspace = (withEvalDb: boolean) => {
    root = mkdtempSync(join(tmpdir(), "copilot-storage-"));
    mkdirSync(join(root, "data"));
    if (withEvalDb) writeFileSync(join(root, "data", "eval.db"), "");
    return root;
  };

  it("routes only datasets and experiments to an existing eval.db", () => {
    const domains = evalDatasetDomains({}, workspace(true));
    expect(Object.keys(domains).sort()).toEqual(["datasets", "experiments"]);
    expect(domains.datasets?.constructor.name).toMatch(/LibSQL/);
    expect(domains.experiments?.constructor.name).toMatch(/LibSQL/);
  });

  it("routes nothing when eval.db is missing", () => {
    expect(evalDatasetDomains({}, workspace(false))).toEqual({});
  });

  it("routes nothing when DATABASE_URL is set", () => {
    expect(evalDatasetDomains({ DATABASE_URL: "file:/tmp/x.db" }, workspace(true))).toEqual({});
  });
});
