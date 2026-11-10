import type { DigestMatch, DiscoveryRun, FunnelResult, SourceState } from "@copilot/db";
import { DISCOVERY_SOURCE_LABELS, triageBand } from "@copilot/shared";
import type { HttpJson } from "./sources/http";

// The per-run email: the run's new matches, best first, with links into the app, plus anything
// that went wrong (failed sources, budget stops, failed steps). Without matches, problems still
// go out as a short alert, at most once a day for the same problems. Everything in it comes
// from job boards or our own error messages: the HTML escapes every value and links only to
// the app's own pages.

const RESEND_URL = "https://api.resend.com/emails";
/** Most matches listed in one email (the rest are on the jobs page). */
export const DIGEST_MAX_MATCHES = 20;

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

export type Digest = { subject: string; text: string; html: string };

/** Don't repeat an alert for the same problems within this long. */
export const ALERT_REPEAT_MS = 24 * 3_600_000;

/**
 * What needs a look after a run: failed sources, paid sources stopped by the monthly budget,
 * sources that returned nothing twice in a row, funnel steps that failed. Expected stops (the
 * per-run spend or triage caps) are not problems.
 */
export function runProblems(
  run: Pick<DiscoveryRun, "sources">,
  funnel: FunnelResult,
  states: SourceState[],
): string[] {
  const label = (s: keyof typeof DISCOVERY_SOURCE_LABELS) => DISCOVERY_SOURCE_LABELS[s];
  const problems = run.sources.flatMap((r) => {
    if (r.status === "failed")
      return [`${label(r.source)} failed: ${r.message ?? "unknown error"}`];
    if (r.status === "skipped" && /budget/i.test(r.message ?? "")) {
      return [`${label(r.source)} skipped: ${r.message}`];
    }
    return [];
  });
  for (const state of states) {
    const result = run.sources.find((r) => r.source === state.source);
    if (state.unhealthy && result?.status !== "failed" && result?.status !== "skipped") {
      problems.push(`${label(state.source)} returned nothing in its last two runs`);
    }
  }
  if (funnel.stoppedBy && / failed: /.test(funnel.stoppedBy)) problems.push(funnel.stoppedBy);
  return problems;
}

/** An alert for these problems was already sent recently (by an earlier run). */
export function alreadyAlerted(problems: string[], recent: DiscoveryRun[], now = Date.now()) {
  const key = [...problems].sort().join("\n");
  return recent.some(
    (r) =>
      r.funnel?.digest?.status === "sent" &&
      (r.funnel.digest.problems ?? []).length > 0 &&
      [...(r.funnel.digest.problems ?? [])].sort().join("\n") === key &&
      now - r.startedAt.getTime() < ALERT_REPEAT_MS,
  );
}

function problemsBlock(problems: string[], base: string) {
  if (problems.length === 0) return { text: "", html: "" };
  return {
    text: ["Needs a look:", ...problems.map((p) => `  - ${p}`), `  ${base}/discovery`, ""].join(
      "\n",
    ),
    html: `<div style="margin:0 0 12px;padding:8px 12px;border:1px solid #e5a000;border-radius:6px"><strong>Needs a look</strong><ul style="margin:4px 0;padding-left:18px">${problems.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul><a href="${escapeHtml(`${base}/discovery`)}">Discovery runs</a></div>`,
  };
}

/** The problems-only email of a run without matches. */
export function buildAlert(problems: string[], baseUrl: string): Digest {
  const base = baseUrl.replace(/\/+$/, "");
  const block = problemsBlock(problems, base);
  return {
    subject: `Job discovery needs a look: ${problems[0]}`.slice(0, 150),
    text: `The latest discovery run found no new matches.\n\n${block.text}`,
    html: `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.4;color:#111"><p>The latest discovery run found no new matches.</p>${block.html}</div>`,
  };
}

export function buildDigest(
  matches: DigestMatch[],
  baseUrl: string,
  problems: string[] = [],
): Digest {
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

  const block = problemsBlock(problems, base);
  const text = [
    block.text,
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
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.4;color:#111">${block.html}<p>${matches.length} new match${matches.length === 1 ? "" : "es"} from the latest discovery run:</p><table style="border-collapse:collapse">${rows}</table>${more > 0 ? `<p><a href="${escapeHtml(`${base}/jobs?tab=new`)}">…and ${more} more</a></p>` : ""}<p style="color:#888;font-size:12px"><a href="${escapeHtml(`${base}/discovery`)}" style="color:#888">All discovery runs</a></p></div>`;
  return { subject, text, html };
}

export type DigestConfig = {
  apiKey?: string;
  to?: string;
  from: string;
  baseUrl: string;
};

/**
 * Sends the run's email: the digest when there are matches (with any problems on top), else a
 * problems-only alert unless the same one went out within a day. Never throws.
 */
export async function sendDigest(
  http: HttpJson,
  config: DigestConfig,
  matches: DigestMatch[],
  problems: string[] = [],
  recent: DiscoveryRun[] = [],
): Promise<NonNullable<FunnelResult["digest"]>> {
  const base = { matches: matches.length, ...(problems.length > 0 ? { problems } : {}) };
  if (matches.length === 0 && problems.length === 0) {
    return { status: "skipped", message: "no new matches", ...base };
  }
  if (matches.length === 0 && alreadyAlerted(problems, recent)) {
    return { status: "skipped", message: "same problems already emailed today", ...base };
  }
  if (!config.apiKey || !config.to) {
    return {
      status: "skipped",
      message: `email not configured (${config.apiKey ? "DIGEST_TO" : "RESEND_API_KEY"} is not set)`,
      ...base,
    };
  }
  const alert = matches.length === 0;
  const email = alert
    ? buildAlert(problems, config.baseUrl)
    : buildDigest(matches, config.baseUrl, problems);
  try {
    await http(new URL(RESEND_URL), {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}` },
      body: {
        from: config.from,
        to: config.to.split(",").map((s) => s.trim()),
        subject: email.subject,
        text: email.text,
        html: email.html,
      },
    });
    return {
      status: "sent",
      message: `${alert ? "alert" : "digest"} sent to ${config.to}`,
      ...base,
      ...(alert ? { alert: true } : {}),
    };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "sending failed",
      ...base,
    };
  }
}
