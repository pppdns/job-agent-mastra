import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStorage, evalDatasetDomains } from "./storage";

describe("createStorage", () => {
  it("keeps memory in libSQL and puts observability in DuckDB", async () => {
    const storage = createStorage({ DATABASE_URL: ":memory:" });
    await storage.init();
    const observability = await storage.getStore("observability");
    expect(observability?.constructor.name).toMatch(/DuckDB/);
    expect((await storage.getStore("memory"))?.constructor.name).toMatch(/LibSQL/);
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
