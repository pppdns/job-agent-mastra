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

/** Something that needs a look: a stable key (for the throttle) and a message (for the email). */
export type Problem = { key: string; message: string };

/** Per-job model failures count as a problem from this many, or when every call failed. */
const MIN_FAILED_CALLS = 3;
const MAX_FAILED_SHARE = 0.1;

const failedMany = (failed: number, done: number) =>
  failed > 0 &&
  (done === 0 || (failed >= MIN_FAILED_CALLS && failed / (failed + done) >= MAX_FAILED_SHARE));

/**
 * What needs a look after a run: failed sources and failed searches of partial ones, paid
 * sources stopped by the monthly budget, sources that returned nothing twice in a row, many
 * failed triage or assessment calls, failed funnel steps. Expected stops (the per-run spend or
 * triage caps) are not problems.
 */
export function runProblems(
  run: Pick<DiscoveryRun, "sources">,
  funnel: FunnelResult,
  states: SourceState[],
): Problem[] {
  const label = (s: keyof typeof DISCOVERY_SOURCE_LABELS) => DISCOVERY_SOURCE_LABELS[s];
  const problems: Problem[] = run.sources.flatMap((r): Problem[] => {
    if (r.status === "failed") {
      return [
        {
          key: `${r.source}:failed`,
          message: `${label(r.source)} failed: ${r.message ?? "unknown error"}`,
        },
      ];
    }
    if (r.status === "partial" && r.failures?.length) {
      const n = r.failures.length;
      return [
        {
          key: `${r.source}:searches-failed`,
          message: `${label(r.source)}: ${n} search${n === 1 ? "" : "es"} failed (${r.failures[0]})`,
        },
      ];
    }
    if (r.status === "skipped" && /budget/i.test(r.message ?? "")) {
      return [{ key: `${r.source}:budget`, message: `${label(r.source)} skipped: ${r.message}` }];
    }
    return [];
  });
  for (const state of states) {
    const result = run.sources.find((r) => r.source === state.source);
    // Only sources this run asked: a triage-only run has none, so it repeats no source alerts.
    if (result && state.unhealthy && result.status !== "failed" && result.status !== "skipped") {
      problems.push({
        key: `${state.source}:empty`,
        message: `${label(state.source)} returned nothing in its last two runs`,
      });
    }
  }
  if (failedMany(funnel.triageFailed, funnel.triaged)) {
    problems.push({
      key: "triage:calls-failed",
      message: `${funnel.triageFailed} of ${funnel.triageFailed + funnel.triaged} triage calls failed`,
    });
  }
  if (failedMany(funnel.assessFailed, funnel.assessed)) {
    problems.push({
      key: "assess:calls-failed",
      message: `${funnel.assessFailed} of ${funnel.assessFailed + funnel.assessed} assessments failed`,
    });
  }
  const step = funnel.stoppedBy?.match(/^(\w+) failed: /)?.[1];
  if (step && funnel.stoppedBy) problems.push({ key: `step:${step}`, message: funnel.stoppedBy });
  return problems;
}

const keyOf = (keys: string[]) => [...keys].sort().join("\n");

/** An alert or digest naming the same problems was sent within ALERT_REPEAT_MS. */
export function alreadyAlerted(problems: Problem[], recent: DiscoveryRun[], now = Date.now()) {
  const key = keyOf(problems.map((p) => p.key));
  return recent.some(
    (r) =>
      r.funnel?.digest?.status === "sent" &&
      (r.funnel.digest.problemKeys ?? []).length > 0 &&
      keyOf(r.funnel.digest.problemKeys ?? []) === key &&
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

/** Subject prefixes, so the emails stand out in the inbox: matches vs problems only. */
export const DIGEST_EMOJI = "🎯";
export const ALERT_EMOJI = "⚠️";

/** The problems-only email of a run without matches. */
export function buildAlert(problems: string[], baseUrl: string): Digest {
  const base = baseUrl.replace(/\/+$/, "");
  const block = problemsBlock(problems, base);
  return {
    subject: `${ALERT_EMOJI} Job discovery needs a look: ${problems[0]}`.slice(0, 150),
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
      ? `${DIGEST_EMOJI} 1 new job match: ${top?.title ?? "untitled"} (${top?.triageScore})`
      : `${DIGEST_EMOJI} ${matches.length} new job matches, best: ${top?.title ?? "untitled"} (${top?.triageScore})`;
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
  problems: Problem[] = [],
  /** Runs of the last ALERT_REPEAT_MS (for the throttle). */
  recent: DiscoveryRun[] = [],
): Promise<NonNullable<FunnelResult["digest"]>> {
  const messages = problems.map((p) => p.message);
  const base = {
    matches: matches.length,
    ...(problems.length > 0 ? { problems: messages, problemKeys: problems.map((p) => p.key) } : {}),
  };
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
    ? buildAlert(messages, config.baseUrl)
    : buildDigest(matches, config.baseUrl, messages);
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
