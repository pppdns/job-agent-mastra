import { JOB_STATUS_LABELS } from "@copilot/shared";
import type { HttpJson } from "../discovery/sources/http";
import { type Email, type EmailConfig, emailNotConfigured, escapeHtml, sendEmail } from "../email";
import type { ClosedJob } from "./run";

// The daily "no longer available" email: the jobs the listing check dismissed, to-apply then
// shortlisted ones first, each with the link that closed and a link to the job in the app (to restore it).
// Sent only when something was dismissed.

export const CLOSED_EMOJI = "🧹";

const plural = (n: number) => `${n} job${n === 1 ? "" : "s"}`;

/** Statuses the user picked by hand, tagged and listed first (most committed first). */
const TAGGED = ["to_apply", "shortlisted"] as const;
type Tagged = (typeof TAGGED)[number];
const rank = (status: string) => {
  const i = TAGGED.indexOf(status as Tagged);
  return i < 0 ? 0 : TAGGED.length - i;
};

export function buildClosedEmail(closed: ClosedJob[], baseUrl: string): Email {
  const base = baseUrl.replace(/\/+$/, "");
  const sorted = [...closed].sort((a, b) => rank(b.previousStatus) - rank(a.previousStatus));
  const counts = TAGGED.map((s) => {
    const n = closed.filter((c) => c.previousStatus === s).length;
    return n > 0 ? `${n} ${JOB_STATUS_LABELS[s].toLowerCase()}` : "";
  }).filter(Boolean);
  const subject = `${CLOSED_EMOJI} ${plural(closed.length)} no longer available${counts.length > 0 ? ` (${counts.join(", ")})` : ""}`;
  const intro = `These listings closed, so the jobs were dismissed. To bring one back, open it and change its status.`;
  const line = (c: ClosedJob) => ({
    title: c.title ?? "Untitled job",
    company: c.company ?? "",
    app: `${base}/jobs/${encodeURIComponent(c.id)}`,
    tag: rank(c.previousStatus) > 0 ? JOB_STATUS_LABELS[c.previousStatus as Tagged] : "",
  });

  const text = [
    intro,
    "",
    ...sorted.flatMap((c) => {
      const l = line(c);
      return [
        `${l.tag ? `[${l.tag}] ` : ""}${l.title}${l.company ? ` — ${l.company}` : ""}`,
        `    ${c.signal}: ${c.url}`,
        `    ${l.app}`,
        "",
      ];
    }),
  ].join("\n");

  const rows = sorted
    .map((c) => {
      const l = line(c);
      return `<tr><td style="padding:8px 0;vertical-align:top">${l.tag ? `<span style="font-size:12px;font-weight:600;color:#b45309">${escapeHtml(l.tag)}</span> ` : ""}<a href="${escapeHtml(l.app)}" style="font-weight:600;color:#111">${escapeHtml(l.title)}</a>${l.company ? `<div style="color:#555">${escapeHtml(l.company)}</div>` : ""}<div style="color:#888;font-size:12px">${escapeHtml(c.signal)} · <a href="${escapeHtml(c.url)}" style="color:#888">listing</a></div></td></tr>`;
    })
    .join("");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.4;color:#111"><p>${escapeHtml(intro)}</p><table style="border-collapse:collapse">${rows}</table></div>`;
  return { subject, text, html };
}

export type ClosedEmailResult = { status: "sent" | "skipped" | "failed"; message: string };

/** Emails the dismissed jobs; nothing to send is `skipped`. Never throws. */
export async function sendClosedEmail(
  http: HttpJson,
  config: EmailConfig,
  closed: ClosedJob[],
): Promise<ClosedEmailResult> {
  if (closed.length === 0) return { status: "skipped", message: "no closed listings" };
  const notConfigured = emailNotConfigured(config);
  if (notConfigured) return { status: "skipped", message: notConfigured };
  try {
    await sendEmail(http, config, buildClosedEmail(closed, config.baseUrl));
    return { status: "sent", message: `sent to ${config.to}` };
  } catch (error) {
    return { status: "failed", message: error instanceof Error ? error.message : "sending failed" };
  }
}
