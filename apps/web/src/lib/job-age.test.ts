import { describe, expect, it } from "vitest";
import {
  compactAge,
  FOLLOW_UP_DAYS,
  formatDay,
  jobAge,
  progressAge,
  STUCK_DAYS,
  stageAge,
} from "./job-age";

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

describe("progressAge", () => {
  const base = {
    postedAt: null,
    postedBasis: null,
    createdAt: ago(40),
    archivedAt: null,
    interviewRound: null,
    progressedAt: null,
  };

  it("needs nothing within a week, then asks for a follow-up, then flags it stuck", () => {
    const applied = (days: number) =>
      progressAge({ ...base, status: "applied", statusChangedAt: ago(days) }, now);
    expect(applied(3)).toMatchObject({
      label: "Applied 3d ago",
      short: "3d",
      tone: "muted",
      attention: null,
    });
    expect(applied(3)?.tooltip).toBe(`Applied ${formatDay(ago(3))}`);
    expect(applied(FOLLOW_UP_DAYS)).toMatchObject({ tone: "warning", attention: "follow_up" });
    expect(applied(FOLLOW_UP_DAYS)?.tooltip).toContain("follow");
    expect(applied(STUCK_DAYS)).toMatchObject({ tone: "destructive", attention: "stuck" });
  });

  it("counts from the latest round and names it", () => {
    const age = progressAge(
      {
        ...base,
        status: "interviewing",
        statusChangedAt: ago(20),
        progressedAt: ago(2),
        interviewRound: 3,
      },
      now,
    );
    expect(age).toMatchObject({ label: "Moved to round 3 2d ago", attention: null });
    const first = progressAge(
      {
        ...base,
        status: "interviewing",
        statusChangedAt: ago(8),
        progressedAt: ago(8),
        interviewRound: 1,
      },
      now,
    );
    expect(first).toMatchObject({ label: "Interviews began 1w ago", attention: "follow_up" });
  });

  it("says what to do per status", () => {
    const at = (status: "shortlisted" | "offer") =>
      progressAge({ ...base, status, statusChangedAt: ago(9) }, now)?.tooltip;
    expect(at("shortlisted")).toContain("apply or drop it");
    expect(at("offer")).toContain("decide");
  });

  it("is null for other statuses, archived jobs and unknown times", () => {
    expect(progressAge({ ...base, status: "new", statusChangedAt: ago(20) }, now)).toBeNull();
    expect(
      progressAge(
        { ...base, status: "applied", statusChangedAt: ago(20), archivedAt: ago(1) },
        now,
      ),
    ).toBeNull();
    expect(progressAge({ ...base, status: "applied", statusChangedAt: null }, now)).toBeNull();
  });
});

describe("stageAge", () => {
  const listing = {
    postedAt: null,
    postedBasis: null,
    createdAt: ago(40),
    archivedAt: null,
    interviewRound: null,
    progressedAt: null,
  };

  it("uses the progress age and adds the listing dates", () => {
    const applied = stageAge({ ...listing, status: "applied", statusChangedAt: ago(15) }, now);
    expect(applied).toMatchObject({ label: "Applied 2w ago", tone: "destructive" });
    expect(applied.tooltip).toContain(`Added ${formatDay(ago(40))}`);
  });

  it("falls back to the listing age without a stage", () => {
    const fallback = stageAge({ ...listing, status: "new", statusChangedAt: null }, now);
    expect(fallback.label).toBe("Added 1mo ago");
    const shortlisted = stageAge(
      { ...listing, status: "shortlisted", statusChangedAt: ago(2) },
      now,
    );
    expect(shortlisted.label).toBe("Added 1mo ago");
  });
});
