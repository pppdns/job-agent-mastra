import type { JobOverview } from "@copilot/db";
import type { JobStatus, PostedBasis } from "@copilot/shared";

const DAY_MS = 86_400_000;

export const APPROXIMATE_HINT = "Approximate: from the listing's relative age when it was read";

/** LinkedIn ages ("3 weeks ago") give approximate dates; employer pages can state exact ones. */
export const isApproximate = (basis: PostedBasis) => basis !== "exact";

export const postedVerb = (basis: PostedBasis) => (basis === "reposted" ? "Reposted" : "Posted");

const dayFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });
// Exact posting dates are stored as UTC midnight; show that calendar day in every time zone.
const utcDayFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });

/** "19 Oct 2026"; with a basis, "~19 Oct 2026" when approximate. */
export function formatDay(date: Date, basis?: PostedBasis): string {
  if (basis === "exact") return utcDayFormat.format(date);
  return `${basis && isApproximate(basis) ? "~" : ""}${dayFormat.format(date)}`;
}

/** Compact age: "today", "5d", "3w", "2mo", "1y". */
export function compactAge(date: Date, now: Date): string {
  const days = Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS));
  if (days < 1) return "today";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export type AgeTone = "success" | "muted" | "warning" | "destructive";

/** An age pill: what it shows, its color, the full dates, and the date it counts from. */
export type Age = { label: string; short: string; tone: AgeTone; tooltip: string; date: Date };

/** Statuses where freshness still matters: the user hasn't applied yet. */
const DECIDING: readonly JobStatus[] = ["new", "shortlisted"];

/**
 * The job's age for the jobs table: since it was posted when a listing says so, otherwise since
 * it was saved. While the user is still deciding, fresh (≤ 7 days) is `success` (apply early) and
 * over 30 days `warning` (may already be filled); after applying, or once archived, it's `muted`.
 */
export function jobAge(
  job: Pick<JobOverview, "postedAt" | "postedBasis" | "createdAt" | "status" | "archivedAt">,
  now: Date,
): Age {
  const added = `Added ${formatDay(job.createdAt)}`;
  const posted =
    job.postedAt && job.postedBasis ? { at: job.postedAt, basis: job.postedBasis } : null;
  const date = posted?.at ?? job.createdAt;
  const age = compactAge(date, now);
  const verb = posted ? postedVerb(posted.basis) : "Added";
  const approx = posted && isApproximate(posted.basis) && age !== "today" ? "~" : "";
  const days = (now.getTime() - date.getTime()) / DAY_MS;
  return {
    label: age === "today" ? `${verb} today` : `${verb} ${approx}${age} ago`,
    /** For narrow screens: "~3w", "today". */
    short: `${approx}${age}`,
    tone:
      !DECIDING.includes(job.status) || job.archivedAt
        ? "muted"
        : days <= 7
          ? "success"
          : days <= 30
            ? "muted"
            : "warning",
    tooltip: posted
      ? `${postedVerb(posted.basis)} ${formatDay(posted.at, posted.basis)}${isApproximate(posted.basis) ? " (approximate)" : ""} · ${added}`
      : added,
    date,
  };
}

/** No progress this long: worth a follow-up (amber). */
export const FOLLOW_UP_DAYS = 7;
/** No progress this long: probably stuck (red). */
export const STUCK_DAYS = 14;

/** What a job in progress needs from the user; null = nothing, progress is recent. */
export type Attention = "follow_up" | "stuck";

/** Time since the last progress, with what it means for the user. */
export type ProgressAge = Age & { attention: Attention | null };

type ProgressJob = Pick<
  JobOverview,
  "status" | "statusChangedAt" | "progressedAt" | "interviewRound" | "archivedAt"
>;

/** Per in-progress status: what the date marks, and what to do when it gets old. */
const STAGE: Partial<Record<JobStatus, { verb: string; followUp: string; stuck: string }>> = {
  shortlisted: {
    verb: "Shortlisted",
    followUp: "not applied yet: apply or drop it",
    stuck: "still not applied: apply or drop it",
  },
  applied: {
    verb: "Applied",
    followUp: "no reply yet: consider following up",
    stuck: "no reply for 2 weeks: follow up or let it go",
  },
  interviewing: {
    verb: "Interviews began",
    followUp: "no news since: consider following up",
    stuck: "no news for 2 weeks: follow up",
  },
  offer: {
    verb: "Offer",
    followUp: "open for a week: decide or ask for time",
    stuck: "open for 2 weeks: decide",
  },
};

/**
 * Time since the job last progressed in the pipeline (a status change or a new interview round),
 * for jobs in progress. Under `FOLLOW_UP_DAYS` it needs nothing (`muted`); then `follow_up`
 * (`warning`), from `STUCK_DAYS` `stuck` (`destructive`). Null for other statuses, archived
 * jobs, or without a change time.
 */
export function progressAge(job: ProgressJob, now: Date): ProgressAge | null {
  const stage = STAGE[job.status];
  const since = job.progressedAt ?? job.statusChangedAt;
  if (!stage || !since || job.archivedAt) return null;
  // A later progress time than the status change while interviewing = a new round.
  const newRound =
    job.status === "interviewing" &&
    job.interviewRound !== null &&
    job.statusChangedAt !== null &&
    since.getTime() > job.statusChangedAt.getTime();
  const verb = newRound ? `Moved to round ${job.interviewRound}` : stage.verb;
  const age = compactAge(since, now);
  const days = (now.getTime() - since.getTime()) / DAY_MS;
  const attention: Attention | null =
    days >= STUCK_DAYS ? "stuck" : days >= FOLLOW_UP_DAYS ? "follow_up" : null;
  const hint = attention === "stuck" ? stage.stuck : attention ? stage.followUp : null;
  return {
    label: age === "today" ? `${verb} today` : `${verb} ${age} ago`,
    short: age,
    tone: attention === "stuck" ? "destructive" : attention ? "warning" : "muted",
    tooltip: `${verb} ${formatDay(since)}${hint ? ` · ${hint}` : ""}`,
    date: since,
    attention,
  };
}

/** Tabs that show time in stage only use it for these statuses; others keep the listing age. */
const STAGE_AGE_STATUSES: readonly JobStatus[] = ["applied", "interviewing", "offer"];

/**
 * Time in the current pipeline stage ("Applied 12d ago"), for tabs where the user waits on the
 * employer: `progressAge` plus the listing's dates in the tooltip. Falls back to the listing age
 * for other statuses, archived jobs, or without a change time.
 */
export function stageAge(
  job: ProgressJob & Pick<JobOverview, "postedAt" | "postedBasis" | "createdAt">,
  now: Date,
): Age {
  const listing = jobAge(job, now);
  const progress = STAGE_AGE_STATUSES.includes(job.status) ? progressAge(job, now) : null;
  if (!progress) return listing;
  return { ...progress, tooltip: `${progress.tooltip} · ${listing.tooltip}` };
}
