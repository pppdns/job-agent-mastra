import { atsKey } from "@copilot/db";
import { linkedInJobId } from "../ingest/listing";

// Is a job listing still open? One deterministic rule per site, each proven on real listings
// from the production database (see corpus.json and AGENTS.md). Anything a rule doesn't
// recognise is `unknown`, and `unknown` never dismisses a job: rate limits, bot walls,
// redirects, server errors and unexpected pages all land there. No keyword guessing: several
// boards show "the job is expired" in a report-this-job menu on every open listing.

export const LISTING_SITES = [
  "linkedin",
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "dice",
  "jobgether",
  "nodesk",
] as const;
export type ListingSite = (typeof LISTING_SITES)[number];

export type Verdict = "open" | "closed" | "unknown";

/** What a site's page or API answered (body capped, redirects not followed). */
export type ProbeResponse = { status: number; body: string };

/** How to check one listing URL: what to fetch and how to read the answer. */
export type ListingProbe = {
  site: ListingSite;
  /** The listing as the user would open it. */
  url: string;
  /** What is fetched: the page itself or the site's public API for that job. */
  fetchUrl: string;
};

export type Classification = { verdict: Verdict; signal: string };

/** LinkedIn's public (logged-out) job endpoint: the job's top card, closed banner included. */
export const linkedinGuestUrl = (id: string) =>
  `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`;

/** `lower` as the URL spells it (a path segment or query value), else `lower` itself. */
function urlSpelling(url: URL, lower: string): string {
  const candidates = [...url.pathname.split("/"), ...url.searchParams.values()];
  for (const raw of candidates) {
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {}
    if (value.toLowerCase().trim() === lower) return value.trim();
  }
  return lower;
}

/** The check for a listing URL, or null when no verified rule covers its site. */
export function planProbe(raw: string): ListingProbe | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || (url.port && url.port !== "443" && url.port !== "80")) {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const href = url.href;

  const linkedin = linkedInJobId(url);
  if (linkedin) return { site: "linkedin", url: href, fetchUrl: linkedinGuestUrl(linkedin) };

  const ats = atsKey(href);
  if (ats) {
    const [kind, company, id] = ats.split(":") as [string, string, string];
    // atsKey lowercases the company, but Lever's API is case-sensitive ("clearer" 404s where
    // "Clearer" is a live job): use the company as the URL spells it.
    const c = encodeURIComponent(urlSpelling(url, company));
    if (kind === "greenhouse") {
      return {
        site: "greenhouse",
        url: href,
        fetchUrl: `https://boards-api.greenhouse.io/v1/boards/${c}/jobs/${id}`,
      };
    }
    if (kind === "lever") {
      const api = host.startsWith("jobs.eu.") ? "api.eu.lever.co" : "api.lever.co";
      return { site: "lever", url: href, fetchUrl: `https://${api}/v0/postings/${c}/${id}` };
    }
    if (kind === "ashby") {
      // The job page itself: a job missing from the company's board API can still be open
      // (unlisted), but a closed one answers 404 here.
      return { site: "ashby", url: href, fetchUrl: `https://jobs.ashbyhq.com/${c}/${id}` };
    }
    return null; // apply.workable.com: no verified rule yet
  }

  const [a, b] = url.pathname.split("/").filter(Boolean);
  const page = `https://${url.hostname}${url.pathname}`;
  if (host === "jobs.workable.com" && a === "view" && b) {
    return { site: "workable", url: href, fetchUrl: page };
  }
  if (host === "dice.com" && a === "job-detail" && b) {
    return { site: "dice", url: href, fetchUrl: page };
  }
  if (host === "jobgether.com" && a === "offer" && b) {
    return { site: "jobgether", url: href, fetchUrl: page };
  }
  if (host === "nodesk.co" && a === "remote-jobs" && b) {
    return { site: "nodesk", url: href, fetchUrl: page };
  }
  return null;
}

const open = (signal: string): Classification => ({ verdict: "open", signal });
const closed = (signal: string): Classification => ({ verdict: "closed", signal });
const unknown = (signal: string): Classification => ({ verdict: "unknown", signal });

const http = (status: number) => `HTTP ${status}`;

/** Reads a site's answer. Only the exact signals verified for that site count as closed. */
export function classify(site: ListingSite, { status, body }: ProbeResponse): Classification {
  switch (site) {
    case "linkedin":
      if (status === 404) return closed("LinkedIn: job removed (404)");
      if (status !== 200) return unknown(http(status));
      if (body.includes("closed-job__flavor--closed")) {
        return closed("LinkedIn: No longer accepting applications");
      }
      return body.includes("top-card-layout__title")
        ? open("LinkedIn: job page")
        : unknown("LinkedIn: unexpected page");
    case "greenhouse":
    case "lever":
      if (status === 404) return closed(`${label(site)} API: job not found (404)`);
      return status === 200 ? open(`${label(site)} API: job found`) : unknown(http(status));
    case "ashby":
      if (status === 404) return closed("Ashby: Job not found (404)");
      return status === 200 ? open("Ashby: job page") : unknown(http(status));
    case "workable":
      if (status === 410) return closed("Workable: This job is not available anymore (410)");
      return status === 200 ? open("Workable: job page") : unknown(http(status));
    case "dice":
      if (status === 410 && /this job is no longer available/i.test(body)) {
        return closed("Dice: this job is no longer available (410)");
      }
      return status === 200 ? open("Dice: job page") : unknown(http(status));
    case "jobgether":
      if (status === 410 && body.includes("This job has expired on Jobgether")) {
        return closed("Jobgether: This job has expired (410)");
      }
      return status === 200 ? open("Jobgether: job page") : unknown(http(status));
    case "nodesk":
      if (status !== 200) return unknown(http(status));
      // The red banner of an expired listing; "The job is expired" alone is the report menu.
      return body.includes("Looks like this career opportunity is no longer available")
        ? closed("NoDesk: career opportunity is no longer available")
        : open("NoDesk: job page");
  }
}

const label = (site: ListingSite) => site[0]?.toUpperCase() + site.slice(1);

/** Fetches a probe's URL once: no redirects, a timeout and a body cap. */
export type ProbeFetch = (url: string, signal?: AbortSignal) => Promise<ProbeResponse>;

const TIMEOUT_MS = 20_000;
const MAX_BODY_CHARS = 2_000_000;
// Several boards answer 403 to non-browser user agents (Jobgether); this is what a click sends.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

const MAX_REDIRECTS = 3;

export const probeFetch: ProbeFetch = async (url, signal) => {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let current = new URL(url);
  let response: Response;
  for (let hop = 0; ; hop++) {
    response = await fetch(current, {
      redirect: "manual",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/json;q=0.9,*/*;q=0.5" },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    // Follow redirects on the same host only (Workable completes a cut-off URL slug); a
    // redirect elsewhere stays a 3xx, which reads as unknown.
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location || hop >= MAX_REDIRECTS) break;
    const next = new URL(location, current);
    if (next.host !== current.host || next.protocol !== "https:") break;
    await response.body?.cancel();
    current = next;
  }
  // Only the start of a page matters (LinkedIn's top card, a board's banner).
  const body = response.status === 200 || response.status === 410 ? await response.text() : "";
  return { status: response.status, body: body.slice(0, MAX_BODY_CHARS) };
};

export type ListingCheck = ListingProbe & Classification & { status?: number };

/** Checks one listing; network failures are `unknown`, never thrown. */
export async function checkListing(
  probe: ListingProbe,
  fetchProbe: ProbeFetch = probeFetch,
  signal?: AbortSignal,
): Promise<ListingCheck> {
  try {
    const response = await fetchProbe(probe.fetchUrl, signal);
    return { ...probe, ...classify(probe.site, response), status: response.status };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ...probe, verdict: "unknown", signal: "could not be reached" };
  }
}
