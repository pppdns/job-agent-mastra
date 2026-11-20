import { describe, expect, it } from "vitest";
import {
  MAX_JOB_LABELS,
  MAX_LABEL_LENGTH,
  normalizeJobLabels,
  normalizeLabelText,
} from "./job-labels";

const label = (text: string, important = false) => ({ text, important });

describe("normalizeJobLabels", () => {
  it("trims, collapses whitespace and drops empty labels", () => {
    expect(normalizeJobLabels([label("  visa   ok "), label(""), label("   ")])).toEqual([
      label("visa ok"),
    ]);
  });

  it("puts important labels first, otherwise keeping the order", () => {
    expect(
      normalizeJobLabels([label("a"), label("b", true), label("c"), label("d", true)]),
    ).toEqual([label("b", true), label("d", true), label("a"), label("c")]);
  });

  it("merges duplicates ignoring case, important if any copy was", () => {
    expect(normalizeJobLabels([label("Referral"), label("referral ", true)])).toEqual([
      label("Referral", true),
    ]);
  });

  it("caps the length of a label and the number of labels", () => {
    expect(normalizeLabelText("x".repeat(50))).toHaveLength(MAX_LABEL_LENGTH);
    const many = Array.from({ length: 12 }, (_, i) => label(`label ${i}`));
    expect(normalizeJobLabels(many)).toHaveLength(MAX_JOB_LABELS);
  });
});
