import { describe, expect, it } from "vitest";
import { isArchived, withArchived } from "./thread-archive";

describe("thread archive metadata", () => {
  const now = new Date("2026-11-03T10:00:00Z");

  it("keeps other metadata keys when archiving", () => {
    const next = withArchived({ other: 1 }, true, now);
    expect(next).toEqual({ other: 1, archivedAt: "2026-11-03T10:00:00.000Z" });
    expect(isArchived(next)).toBe(true);
  });

  it("removes only the archive key when unarchiving", () => {
    const next = withArchived({ other: 1, archivedAt: "2026-01-01T00:00:00.000Z" }, false);
    expect(next).toEqual({ other: 1 });
    expect(isArchived(next)).toBe(false);
  });

  it("handles missing metadata", () => {
    expect(isArchived(null)).toBe(false);
    expect(withArchived(undefined, false)).toEqual({});
  });
});
