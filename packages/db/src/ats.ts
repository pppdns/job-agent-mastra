// The stable identity of a job on an applicant tracking system, read from its URL:
// `greenhouse:<board>:<job id>`, `lever:<company>:<posting id>`, `ashby:<company>:<job id>`,
// `workable:<account>:<shortcode>`. Two URLs with the same key are the same job, whichever
// board linked to it or however the URL is written (host variant, /apply suffix, query).
// Pure parsing, no fetch.

const ATS = ["greenhouse", "lever", "ashby", "workable"] as const;
export type Ats = (typeof ATS)[number];

const SLUG = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NUMBER = /^\d{1,20}$/;
const SHORTCODE = /^[0-9a-z]{4,20}$/;

const key = (ats: Ats, company: string | undefined, id: string | undefined, idShape: RegExp) => {
  const c = company ? safeDecode(company).toLowerCase().trim() : "";
  const j = id?.toLowerCase() ?? "";
  return SLUG.test(c) && idShape.test(j) ? `${ats}:${c}:${j}` : null;
};

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** The ATS key of a job URL, or null when it isn't a job on Greenhouse, Lever, Ashby or Workable. */
export function atsKey(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const [a, b, c] = parsed.pathname.split("/").filter(Boolean);

  // boards.greenhouse.io/acme/jobs/123, job-boards(.eu).greenhouse.io/acme/jobs/123,
  // boards.greenhouse.io/embed/job_app?for=acme&token=123
  if (/^(job-)?boards(\.eu)?\.greenhouse\.io$/.test(host)) {
    if (a === "embed") {
      return key(
        "greenhouse",
        parsed.searchParams.get("for") ?? undefined,
        parsed.searchParams.get("token") ?? undefined,
        NUMBER,
      );
    }
    return b === "jobs" ? key("greenhouse", a, c, NUMBER) : null;
  }
  // jobs.lever.co/acme/<uuid>(/apply), jobs.eu.lever.co/…
  if (/^jobs(\.eu)?\.lever\.co$/.test(host)) return key("lever", a, b, UUID);
  // jobs.ashbyhq.com/acme/<uuid>(/application)
  if (host === "jobs.ashbyhq.com") return key("ashby", a, b, UUID);
  // apply.workable.com/acme/j/ABC123(/apply), acme.workable.com/j/ABC123
  if (host === "apply.workable.com") return b === "j" ? key("workable", a, c, SHORTCODE) : null;
  const account = /^([a-z0-9-]+)\.workable\.com$/.exec(host)?.[1];
  if (account && !["apply", "jobs", "www"].includes(account)) {
    return a === "j" ? key("workable", account, b, SHORTCODE) : null;
  }
  return null;
}
