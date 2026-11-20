import { describe, expect, it } from "vitest";
import { MAX_JOB_LABELS, MAX_LABEL_LENGTH, normalizeJobLabels, normalizeLabel } from "./job-labels";

describe("normalizeJobLabels", () => {
  it("trims, collapses whitespace and drops empty labels", () => {
    expect(normalizeJobLabels(["  visa   ok ", "", "   ", "referral"])).toEqual([
      "visa ok",
      "referral",
    ]);
  });

  it("drops duplicates ignoring case, keeping the first spelling", () => {
    expect(normalizeJobLabels(["Referral", "referral", "REFERRAL "])).toEqual(["Referral"]);
  });

  it("caps the length of a label and the number of labels", () => {
    expect(normalizeLabel("x".repeat(50))).toHaveLength(MAX_LABEL_LENGTH);
    const many = Array.from({ length: 12 }, (_, i) => `label ${i}`);
    expect(normalizeJobLabels(many)).toHaveLength(MAX_JOB_LABELS);
  });
});
