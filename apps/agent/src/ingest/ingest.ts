import {
  addSource,
  canonicalWebUrl,
  type Db,
  findJobByUrl,
  type JobOverview,
  listJobs,
  type SourceKind,
  type SourceProvider,
  upsertJob,
} from "@copilot/db";
import type { PageResult, WebProviders } from "../web/providers";
import { withRetry } from "../web/retry";
import {
  canonicalLinkedInUrl,
  isLinkedInHost,
  type ListingFields,
  linkedInJobId,
  MIN_PAGE_WORDS,
  matchesIdentity,
  type ParsedPage,
  parseGenericPage,
  parseLinkedInPage,
  wordCount,
} from "./listing";
import { checkUrl, type Resolver } from "./url-guard";

export { canonicalWebUrl };

export const MAX_PASTE_CHARS = 50_000;

/** Employer applicant-tracking systems searched when LinkedIn doesn't give the full listing. */
export const ATS_DOMAINS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workable.com",
  "smartrecruiters.com",
  "myworkdayjobs.com",
  "recruitee.com",
  "teamtailor.com",
  "personio.de",
  "personio.com",
  "rippling-ats.com",
  "bamboohr.com",
  "breezy.hr",
  "jobvite.com",
];
const MAX_ATS_CANDIDATES = 3;

export type Attempt = { step: string; url?: string; outcome: string };

export type SavedSource = {
  id: string;
  kind: SourceKind;
  provider: SourceProvider;
  url: string | null;
  retrievedAt: string;
};

export type IngestResult =
  | {
      status: "saved";
      jobId: string;
      newJob: boolean;
      /** False for pasted text short enough to be a snippet. */
      complete: boolean;
      source: SavedSource;
      listing: ListingFields;
      attempts: Attempt[];
    }
  | {
      status: "needs_paste";
      reason: string;
      /** Identity seen on an incomplete page, if any. */
      partial?: { title?: string; company?: string; location?: string };
      attempts: Attempt[];
    }
  | {
      /** The URL belongs to a job saved earlier; nothing was fetched or saved. */
      status: "already_saved";
      jobId: string;
      job: SavedJobSummary;
    }
  | { status: "blocked"; reason: string };

export type SavedJobSummary = Pick<
  JobOverview,
  "title" | "company" | "location" | "status" | "profileStale"
> & {
  archived: boolean;
  /** Current assessment version, null if the job was never assessed. */
  assessmentVersion: number | null;
  verdict: string | null;
  savedAt: string;
};

export type IngestDeps = {
  db: Db;
  /** Null when no web provider is configured: URLs then fall back to asking for a paste. */
  web: WebProviders | null;
  resolve?: Resolver;
  signal?: AbortSignal;
};

type Found = {
  page: ParsedPage;
  text: string;
  kind: SourceKind;
  provider: SourceProvider;
  url: string;
};

/**
 * Reads and saves a listing URL. Unless `refresh` is set, a URL that already belongs to a saved
 * job (same LinkedIn id, canonical URL or listing snapshot URL) returns `already_saved` before
 * any provider call.
 */
export async function ingestUrl(
  rawUrl: string,
  context: { threadId?: string; refresh?: boolean },
  deps: IngestDeps,
): Promise<IngestResult> {
  const checked = await checkUrl(rawUrl, deps.resolve);
  if (!checked.ok) return { status: "blocked", reason: checked.reason };
  if (!context.refresh) {
    const saved = await savedJobFor(deps.db, checked.url);
    if (saved) return saved;
  }
  const attempts: Attempt[] = [];
  if (!deps.web) {
    return {
      status: "needs_paste",
      reason: "web extraction is not configured on this server",
      attempts,
    };
  }

  if (isLinkedInHost(checked.url)) {
    return ingestLinkedIn(checked.url, context, deps, deps.web, attempts);
  }

  const url = canonicalWebUrl(checked.url);
  const found = await readPage(url, deps, deps.web, attempts);
  if (!found) {
    return { status: "needs_paste", reason: "the page could not be read in full", attempts };
  }
  return save(deps.db, { canonicalUrl: url, title: found.page.title }, found, context, attempts);
}

async function savedJobFor(db: Db, url: URL): Promise<IngestResult | null> {
  const linkedinJobId = isLinkedInHost(url) ? linkedInJobId(url) : null;
  const urls = linkedinJobId ? [canonicalLinkedInUrl(linkedinJobId)] : [url.href];
  const job = await findJobByUrl(db, { linkedinJobId, urls });
  const [overview] = job ? await listJobs(db, [job.id]) : [];
  if (!overview) return null;
  return {
    status: "already_saved",
    jobId: overview.id,
    job: {
      title: overview.title,
      company: overview.company,
      location: overview.location,
      status: overview.status,
      archived: overview.archivedAt !== null,
      assessmentVersion: overview.draftVersion,
      verdict: overview.summary?.verdict ?? null,
      profileStale: overview.profileStale,
      savedAt: overview.createdAt.toISOString(),
    },
  };
}

async function ingestLinkedIn(
  url: URL,
  context: { threadId?: string },
  deps: IngestDeps,
  web: WebProviders,
  attempts: Attempt[],
): Promise<IngestResult> {
  const jobId = linkedInJobId(url);
  if (!jobId) {
    return {
      status: "needs_paste",
      reason: "this is not a LinkedIn job URL (expected linkedin.com/jobs/view/<id>)",
      attempts,
    };
  }
  const canonical = canonicalLinkedInUrl(jobId);
  let partial: ParsedPage | undefined;

  for (const depth of ["basic", "advanced"] as const) {
    const result = await safeExtract(web, canonical, depth, deps.signal);
    if (!result.ok) {
      attempts.push({ step: `linkedin:${depth}`, url: canonical, outcome: result.error });
      continue;
    }
    if (!(await finalUrlAllowed(result.finalUrl, deps, attempts))) break;
    const page = parseLinkedInPage(result.text);
    if (page.completeness.complete) {
      attempts.push({ step: `linkedin:${depth}`, url: canonical, outcome: "complete" });
      return save(
        deps.db,
        { linkedinJobId: jobId, canonicalUrl: canonical, ...identityOf(page) },
        { page, text: result.text, kind: "linkedin", provider: "tavily", url: canonical },
        context,
        attempts,
      );
    }
    attempts.push({ step: `linkedin:${depth}`, url: canonical, outcome: page.completeness.detail });
    if (page.title && page.company) partial = page;
  }

  if (partial?.title && partial.company) {
    const expected = { title: partial.title, company: partial.company };
    const employer = await findEmployerListing(expected, deps, web, attempts);
    if (employer) {
      return save(
        deps.db,
        { linkedinJobId: jobId, canonicalUrl: canonical, ...identityOf(partial) },
        employer,
        context,
        attempts,
      );
    }
  }

  return {
    status: "needs_paste",
    reason: partial
      ? "LinkedIn showed only part of the listing and no matching employer posting was found"
      : "LinkedIn did not return the listing (sign-in, search or missing page)",
    partial: partial ? identityOf(partial) : undefined,
    attempts,
  };
}

/** Searches employer ATS boards; accepts a page only if it is complete and names the same title and company. */
async function findEmployerListing(
  expected: { title: string; company: string },
  deps: IngestDeps,
  web: WebProviders,
  attempts: Attempt[],
): Promise<Found | null> {
  let hits: Awaited<ReturnType<WebProviders["search"]>>;
  try {
    hits = await withRetry(
      () =>
        web.search(
          `"${expected.title}" "${expected.company}"`,
          { maxResults: 5, includeDomains: ATS_DOMAINS },
          deps.signal,
        ),
      { signal: deps.signal },
    );
  } catch (error) {
    attempts.push({ step: "ats:search", outcome: errorText(error) });
    return null;
  }
  attempts.push({ step: "ats:search", outcome: `${hits.length} results` });

  for (const hit of hits.slice(0, MAX_ATS_CANDIDATES)) {
    const checked = await checkUrl(hit.url, deps.resolve);
    if (!checked.ok) {
      attempts.push({ step: "ats:candidate", url: hit.url, outcome: checked.reason });
      continue;
    }
    const result = await safeExtract(web, checked.url.href, "basic", deps.signal);
    if (!result.ok) {
      attempts.push({ step: "ats:candidate", url: hit.url, outcome: result.error });
      continue;
    }
    const page = parseGenericPage(result.text);
    if (!page.completeness.complete) {
      attempts.push({ step: "ats:candidate", url: hit.url, outcome: page.completeness.detail });
    } else if (!matchesIdentity(page, expected)) {
      attempts.push({ step: "ats:candidate", url: hit.url, outcome: "different job or company" });
    } else {
      attempts.push({ step: "ats:candidate", url: hit.url, outcome: "matched" });
      // Stored without tracking parameters, so a later link to the same posting matches it.
      return {
        page,
        text: result.text,
        kind: "ats",
        provider: "tavily",
        url: canonicalWebUrl(checked.url),
      };
    }
  }
  return null;
}

/** Non-LinkedIn page: Tavily first, Firecrawl as the second extractor. */
async function readPage(
  url: string,
  deps: IngestDeps,
  web: WebProviders,
  attempts: Attempt[],
): Promise<Found | null> {
  const kind: SourceKind = isAtsUrl(url) ? "ats" : "web";
  const scrape = web.scrape;
  const readers: { provider: SourceProvider; read: () => Promise<PageResult> }[] = [
    { provider: "tavily", read: () => safeExtract(web, url, "basic", deps.signal) },
  ];
  if (scrape) readers.push({ provider: "firecrawl", read: () => scrape(url, deps.signal) });

  for (const reader of readers) {
    const result = await reader
      .read()
      .catch((error) => ({ ok: false as const, error: errorText(error) }));
    if (!result.ok) {
      attempts.push({ step: reader.provider, url, outcome: result.error });
      continue;
    }
    if (!(await finalUrlAllowed(result.finalUrl, deps, attempts))) return null;
    const page = parseGenericPage(result.text);
    attempts.push({
      step: reader.provider,
      url,
      outcome: page.completeness.complete ? "complete" : page.completeness.detail,
    });
    if (page.completeness.complete) {
      return { page, text: result.text, kind, provider: reader.provider, url };
    }
  }
  return null;
}

/** Pasted listing text. Saved as given; short text is flagged as a possible snippet. */
export async function ingestText(
  text: string,
  hints: { title?: string; company?: string },
  context: { threadId?: string },
  deps: Pick<IngestDeps, "db">,
): Promise<IngestResult> {
  const bounded = text.trim().slice(0, MAX_PASTE_CHARS);
  const page = parseGenericPage(bounded);
  const complete = wordCount(bounded) >= MIN_PAGE_WORDS;
  const attempts: Attempt[] = [
    { step: "pasted", outcome: complete ? "complete" : `only ${wordCount(bounded)} words` },
  ];
  const result = await save(
    deps.db,
    { title: hints.title ?? page.title, company: hints.company },
    { page, text: bounded, kind: "pasted", provider: "user", url: "" },
    context,
    attempts,
  );
  return result.status === "saved" ? { ...result, complete } : result;
}

async function save(
  db: Db,
  identity: Parameters<typeof upsertJob>[1],
  found: Found,
  context: { threadId?: string },
  attempts: Attempt[],
): Promise<IngestResult> {
  const { job, created } = await upsertJob(db, identity);
  const { source } = await addSource(db, {
    jobId: job.id,
    kind: found.kind,
    provider: found.provider,
    url: found.url || null,
    content: found.text,
    threadId: context.threadId ?? null,
  });
  return {
    status: "saved",
    jobId: job.id,
    newJob: created,
    complete: true,
    source: {
      id: source.id,
      kind: source.kind,
      provider: source.provider,
      url: source.url,
      retrievedAt: source.retrievedAt.toISOString(),
    },
    listing: {
      title: found.page.title ?? job.title ?? undefined,
      company: found.page.company ?? job.company ?? undefined,
      location: found.page.location ?? job.location ?? undefined,
      description: found.page.description,
      criteria: found.page.criteria,
    },
    attempts,
  };
}

async function finalUrlAllowed(
  finalUrl: string | undefined,
  deps: IngestDeps,
  attempts: Attempt[],
): Promise<boolean> {
  if (!finalUrl) return true;
  const checked = await checkUrl(finalUrl, deps.resolve);
  if (!checked.ok) attempts.push({ step: "redirect", url: finalUrl, outcome: checked.reason });
  return checked.ok;
}

const identityOf = (page: ParsedPage) => ({
  title: page.title,
  company: page.company,
  location: page.location,
});

const isAtsUrl = (url: string) => {
  const host = new URL(url).hostname;
  return ATS_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
};

/** Provider read with bounded retries; a final failure becomes an `ok: false` result. */
async function safeExtract(
  web: WebProviders,
  url: string,
  depth: "basic" | "advanced",
  signal?: AbortSignal,
): Promise<PageResult> {
  try {
    return await withRetry(() => web.extract(url, depth, signal), { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ok: false, error: errorText(error) };
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
