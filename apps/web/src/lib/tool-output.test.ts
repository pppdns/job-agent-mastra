import { describe, expect, it } from "vitest";
import { toolFailure } from "./tool-output";

describe("toolFailure", () => {
  it("is undefined for successful outputs", () => {
    expect(toolFailure({ ok: true, version: 1 })).toBeUndefined();
    expect(toolFailure({ status: "saved" })).toBeUndefined();
    expect(toolFailure(undefined)).toBeUndefined();
  });

  it("returns our tools' rule errors", () => {
    expect(toolFailure({ ok: false, error: "unknown job id x" })).toBe("unknown job id x");
  });

  it("keeps only the issues of a Mastra input-validation result", () => {
    const message =
      "Tool input validation failed for save_job_draft. Please fix the following errors and try again:\n" +
      "- assessment.headline: Too big: expected string to have <=140 characters\n\n" +
      'Provided arguments: {\n  "jobId": "j1"\n}';
    expect(toolFailure({ error: true, message })).toBe(
      "Invalid input: assessment.headline: Too big: expected string to have <=140 characters",
    );
  });
});
