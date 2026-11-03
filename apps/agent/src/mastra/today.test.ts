import { expect, it } from "vitest";
import { todayLine } from "./today";

it("formats the local date with its weekday", () => {
  expect(todayLine(new Date(2026, 10, 3, 23, 30))).toBe(
    "Today is 2026-11-03 (Tuesday). Use it to judge how old listings, news and reviews are.",
  );
});
