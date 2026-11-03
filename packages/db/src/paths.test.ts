import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findWorkspaceRoot, resolveDatabaseUrl, resolveObservabilityPath } from "./paths";

describe("database paths", () => {
  it("finds the workspace root from a nested directory", () => {
    const root = mkdtempSync(join(tmpdir(), "ws-"));
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    expect(findWorkspaceRoot(join(root, "apps/agent/.mastra/output"))).toBe(root);
  });

  it("prefers DATABASE_URL when set", () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: "file:/tmp/x.db" })).toBe("file:/tmp/x.db");
  });

  it("defaults to <root>/data/copilot.db", () => {
    expect(resolveDatabaseUrl({})).toMatch(/\/data\/copilot\.db$/);
  });

  it("puts the observability DuckDB file next to the libSQL file", () => {
    expect(resolveObservabilityPath({ DATABASE_URL: "file:/tmp/e2e.db" })).toBe("/tmp/e2e.duckdb");
    expect(resolveObservabilityPath({})).toMatch(/\/data\/copilot\.duckdb$/);
    expect(resolveObservabilityPath({ DATABASE_URL: ":memory:" })).toBe(":memory:");
  });
});
