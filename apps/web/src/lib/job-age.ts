import type { JobOverview } from "@copilot/db";
import type { PostedBasis } from "@copilot/shared";

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

export type AgeTone = "info" | "muted" | "warning";

/**
 * The job's age for the jobs table: since it was posted when a listing says so, otherwise since
 * it was saved. Fresh (≤ 7 days) is `info`, over 30 days `warning` (may already be filled).
 */
export function jobAge(
  job: Pick<JobOverview, "postedAt" | "postedBasis" | "createdAt">,
  now: Date,
): { label: string; tone: AgeTone; tooltip: string } {
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
    tone: days <= 7 ? "info" : days <= 30 ? "muted" : "warning",
    tooltip: posted
      ? `${postedVerb(posted.basis)} ${formatDay(posted.at, posted.basis)}${isApproximate(posted.basis) ? " (approximate)" : ""} · ${added}`
      : added,
  };
}
