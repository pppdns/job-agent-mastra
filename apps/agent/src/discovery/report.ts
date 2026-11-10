import type { DigestMatch, FunnelResult } from "@copilot/db";
import { DISCOVERY_SOURCE_LABELS, triageBand } from "@copilot/shared";
import type { HttpJson } from "./sources/http";

// The per-run email digest: the run's new matches, best first, with links into the app.
// Everything in it comes from job boards (untrusted): the HTML version escapes every value and
// links only to the app's own pages.

const RESEND_URL = "https://api.resend.com/emails";
/** Most matches listed in one email (the rest are on the jobs page). */
export const DIGEST_MAX_MATCHES = 20;

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

export type Digest = { subject: string; text: string; html: string };

export function buildDigest(matches: DigestMatch[], baseUrl: string): Digest {
  const base = baseUrl.replace(/\/+$/, "");
  const shown = matches.slice(0, DIGEST_MAX_MATCHES);
  const top = shown[0];
  const subject =
    matches.length === 1
      ? `1 new job match: ${top?.title ?? "untitled"} (${top?.triageScore})`
      : `${matches.length} new job matches, best: ${top?.title ?? "untitled"} (${top?.triageScore})`;
  const line = (m: DigestMatch) => ({
    title: m.title ?? "Untitled job",
    meta: [m.company, m.location].filter(Boolean).join(" · "),
    why: m.headline ?? m.triageReason ?? "",
    via: m.sources.map((s) => DISCOVERY_SOURCE_LABELS[s]).join(", "),
    url: `${base}/jobs/${encodeURIComponent(m.id)}`,
  });
  const more = matches.length - shown.length;

  const text = [
    `${matches.length} new match${matches.length === 1 ? "" : "es"} from the latest discovery run:`,
    "",
    ...shown.flatMap((m) => {
      const l = line(m);
      return [
        `${m.triageScore}  ${l.title}${l.meta ? ` — ${l.meta}` : ""}`,
        l.why && `    ${l.why}`,
        `    ${l.url}${l.via ? ` (via ${l.via})` : ""}`,
        "",
      ].filter((s) => s !== "");
    }),
    more > 0 ? `…and ${more} more: ${base}/jobs?tab=new` : "",
    `All runs: ${base}/discovery`,
  ]
    .filter((s) => s !== "")
    .join("\n");

  const rows = shown
    .map((m) => {
      const l = line(m);
      const band = triageBand(m.triageScore);
      return `<tr><td style="padding:8px 12px 8px 0;vertical-align:top;font-weight:600;white-space:nowrap" title="${band}">${m.triageScore}</td><td style="padding:8px 0;vertical-align:top"><a href="${escapeHtml(l.url)}" style="font-weight:600;color:#111">${escapeHtml(l.title)}</a>${l.meta ? `<div style="color:#555">${escapeHtml(l.meta)}</div>` : ""}${l.why ? `<div style="margin-top:2px">${escapeHtml(l.why)}</div>` : ""}${l.via ? `<div style="color:#888;font-size:12px">via ${escapeHtml(l.via)}</div>` : ""}</td></tr>`;
    })
    .join("");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.4;color:#111"><p>${matches.length} new match${matches.length === 1 ? "" : "es"} from the latest discovery run:</p><table style="border-collapse:collapse">${rows}</table>${more > 0 ? `<p><a href="${escapeHtml(`${base}/jobs?tab=new`)}">…and ${more} more</a></p>` : ""}<p style="color:#888;font-size:12px"><a href="${escapeHtml(`${base}/discovery`)}" style="color:#888">All discovery runs</a></p></div>`;
  return { subject, text, html };
}

export type DigestConfig = {
  apiKey?: string;
  to?: string;
  from: string;
  baseUrl: string;
};

/** Sends the digest; never throws (the result says what happened). */
export async function sendDigest(
  http: HttpJson,
  config: DigestConfig,
  matches: DigestMatch[],
): Promise<NonNullable<FunnelResult["digest"]>> {
  if (matches.length === 0) {
    return { status: "skipped", message: "no new matches", matches: 0 };
  }
  if (!config.apiKey || !config.to) {
    return {
      status: "skipped",
      message: `email not configured (${config.apiKey ? "DIGEST_TO" : "RESEND_API_KEY"} is not set)`,
      matches: matches.length,
    };
  }
  const digest = buildDigest(matches, config.baseUrl);
  try {
    await http(new URL(RESEND_URL), {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}` },
      body: {
        from: config.from,
        to: config.to.split(",").map((s) => s.trim()),
        subject: digest.subject,
        text: digest.text,
        html: digest.html,
      },
    });
    return { status: "sent", message: `sent to ${config.to}`, matches: matches.length };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "sending failed",
      matches: matches.length,
    };
  }
}
