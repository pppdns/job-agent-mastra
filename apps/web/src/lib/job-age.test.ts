import { describe, expect, it } from "vitest";
import { compactAge, formatDay, jobAge, stageAge } from "./job-age";

const DAY = 86_400_000;
const now = new Date("2026-11-09T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * DAY);
const open = { status: "new", archivedAt: null } as const;

describe("compactAge", () => {
  it("rounds down to the largest whole unit", () => {
    expect(compactAge(ago(0.5), now)).toBe("today");
    expect(compactAge(ago(6), now)).toBe("6d");
    expect(compactAge(ago(7), now)).toBe("1w");
    expect(compactAge(ago(29), now)).toBe("4w");
    expect(compactAge(ago(30), now)).toBe("1mo");
    expect(compactAge(ago(400), now)).toBe("1y");
    expect(compactAge(new Date(now.getTime() + DAY), now)).toBe("today");
  });
});

describe("formatDay", () => {
  it("marks approximate dates and shows exact ones as their UTC calendar day", () => {
    expect(formatDay(new Date(Date.UTC(2026, 2, 2)), "exact")).toBe("2 Mar 2026");
    expect(formatDay(new Date("2026-10-19T12:00:00Z"), "relative")).toBe("~19 Oct 2026");
  });
});

describe("jobAge", () => {
  const createdAt = ago(2);

  it("uses the posted date when known, approximate for relative ages", () => {
    expect(
      jobAge({ ...open, postedAt: ago(21), postedBasis: "relative", createdAt }, now),
    ).toMatchObject({
      label: "Posted ~3w ago",
      short: "~3w",
      tone: "muted",
      tooltip: `Posted ~${formatDay(ago(21))} (approximate) · Added ${formatDay(createdAt)}`,
    });
    expect(
      jobAge({ ...open, postedAt: ago(3), postedBasis: "reposted", createdAt }, now).label,
    ).toBe("Reposted ~3d ago");
    const exact = jobAge({ ...open, postedAt: ago(40), postedBasis: "exact", createdAt }, now);
    expect(exact).toMatchObject({ label: "Posted 1mo ago", tone: "warning" });
  });

  it("falls back to when the job was added", () => {
    expect(jobAge({ ...open, postedAt: null, postedBasis: null, createdAt }, now)).toMatchObject({
      label: "Added 2d ago",
      short: "2d",
      tone: "success",
      tooltip: `Added ${formatDay(createdAt)}`,
    });
    expect(
      jobAge({ ...open, postedAt: null, postedBasis: null, createdAt: ago(0.1) }, now).label,
    ).toBe("Added today");
  });

  it("tints by freshness while the user is still deciding", () => {
    const tone = (days: number) =>
      jobAge({ ...open, postedAt: null, postedBasis: null, createdAt: ago(days) }, now).tone;
    expect([tone(7), tone(8), tone(30), tone(31)]).toEqual([
      "success",
      "muted",
      "muted",
      "warning",
    ]);
    const shortlisted = { ...open, status: "shortlisted" as const };
    expect(
      jobAge({ ...shortlisted, postedAt: null, postedBasis: null, createdAt: ago(1) }, now).tone,
    ).toBe("success");
  });

  it("stays neutral once applied or archived", () => {
    const fresh = { postedAt: null, postedBasis: null, createdAt: ago(1) };
    expect(jobAge({ ...fresh, status: "applied", archivedAt: null }, now).tone).toBe("muted");
    expect(jobAge({ ...fresh, status: "new", archivedAt: ago(0) }, now).tone).toBe("muted");
    const old = { postedAt: null, postedBasis: null, createdAt: ago(60) };
    expect(jobAge({ ...old, status: "interviewing", archivedAt: null }, now).tone).toBe("muted");
  });
});

describe("stageAge", () => {
  const listing = { postedAt: null, postedBasis: null, createdAt: ago(40), archivedAt: null };

  it("counts from the status change and flags applications to follow up", () => {
    const applied = (days: number) =>
      stageAge({ ...listing, status: "applied", statusChangedAt: ago(days) }, now);
    expect(applied(3)).toMatchObject({ label: "Applied 3d ago", short: "3d", tone: "muted" });
    expect(applied(15)).toMatchObject({ label: "Applied 2w ago", tone: "warning" });
    expect(applied(15).tooltip).toContain("consider following up");
    expect(applied(15).tooltip).toContain(`Added ${formatDay(ago(40))}`);
    const interviewing = stageAge(
      { ...listing, status: "interviewing", statusChangedAt: ago(20) },
      now,
    );
    expect(interviewing).toMatchObject({ label: "Interviews began 2w ago", tone: "muted" });
  });

  it("falls back to the listing age without a stage", () => {
    const fallback = stageAge({ ...listing, status: "new", statusChangedAt: null }, now);
    expect(fallback.label).toBe("Added 1mo ago");
  });
});
