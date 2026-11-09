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

export type AgeTone = "success" | "muted" | "warning";

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

/** No reply this long after applying: worth a follow-up. */
export const FOLLOW_UP_DAYS = 14;

const STAGE_VERB: Partial<Record<JobStatus, string>> = {
  applied: "Applied",
  interviewing: "Interviews began",
  offer: "Offer",
};

/**
 * Time in the current pipeline stage ("Applied 12d ago"), for tabs where the user waits on the
 * employer. An application with no change for `FOLLOW_UP_DAYS` is `warning`. Falls back to the
 * listing age for other statuses or without a status change time.
 */
export function stageAge(
  job: Pick<
    JobOverview,
    "postedAt" | "postedBasis" | "createdAt" | "status" | "statusChangedAt" | "archivedAt"
  >,
  now: Date,
): Age {
  const listing = jobAge(job, now);
  const verb = STAGE_VERB[job.status];
  const since = job.statusChangedAt;
  if (!verb || !since) return listing;
  const age = compactAge(since, now);
  const days = (now.getTime() - since.getTime()) / DAY_MS;
  const followUp = job.status === "applied" && !job.archivedAt && days >= FOLLOW_UP_DAYS;
  return {
    label: age === "today" ? `${verb} today` : `${verb} ${age} ago`,
    short: age,
    tone: followUp ? "warning" : "muted",
    tooltip: `${verb} ${formatDay(since)}${followUp ? " · no change since: consider following up" : ""} · ${listing.tooltip}`,
    date: since,
  };
}
