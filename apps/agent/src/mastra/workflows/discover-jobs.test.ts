import { describe, expect, it } from "vitest";
import { discoverJobsWorkflow, discoveryScheduleEnabled } from "./discover-jobs";

describe("discoveryScheduleEnabled", () => {
  it("fires on the production machine and in the main checkout's dev server only", () => {
    const fly = {
      NODE_ENV: "production",
      DATABASE_URL: "file:/data/copilot.db",
      AGENT_PORT: "4111",
    };
    expect(discoveryScheduleEnabled(fly, "on")).toBe(true);
    expect(discoveryScheduleEnabled({}, "on")).toBe(true); // main checkout, default port and DB
    expect(discoveryScheduleEnabled({ AGENT_PORT: "4151" }, "on")).toBe(false); // a worktree
    expect(discoveryScheduleEnabled({ DATABASE_URL: "file:data/e2e.db" }, "on")).toBe(false); // e2e, evals
    expect(discoveryScheduleEnabled(fly, "off")).toBe(false);
  });
});

describe("discoverJobsWorkflow", () => {
  it("is not restarted at boot (startup marks a cut-off run interrupted instead)", () => {
    expect(discoverJobsWorkflow.options.autoRestartActiveRuns).toBe(false);
  });
});
