import { type PostingInput, postingInputSchema } from "@copilot/shared";
import { htmlToText, httpUrl, regionList, str } from "../text";
import { SourceError } from "../types";
import { createFeedSource } from "./feed";
import type { HttpJson } from "./http";

// Remotive's public API (https://remotive.com/api-documentation): a small, 24h-delayed set of
// remote jobs. Terms: link back to the job on Remotive and name Remotive as the source; at most
// about 4 requests a day (we make one per run, twice a day). The search parameters are ignored
// by the free API, so one request reads everything.

const API_URL = "https://remotive.com/api/remote-jobs";

export function parseRemotiveJob(raw: unknown): PostingInput | null {
  if (!raw || typeof raw !== "object") return null;
  const job = raw as Record<string, unknown>;
  const id = str(String(job.id ?? ""), 50);
  const url = httpUrl(job.url);
  if (!id || !/^\d+$/.test(id) || !url) return null;
  const where = str(job.candidate_required_location, 300);
  const published = str(job.publication_date, 40);
  // Dates come without a zone; Remotive is UTC.
  const postedAt = published
    ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(published) ? published : `${published}Z`)
    : null;
  const parsed = postingInputSchema.safeParse({
    source: "remotive",
    externalId: id,
    url,
    applyUrl: null,
    title: str(job.title),
    company: str(job.company_name, 200),
    location: where ? `Remote (${where})` : "Remote",
    remote: true,
    regions: regionList(where),
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    salaryText: str(job.salary, 200),
    seniority: null,
    employmentType: str(job.job_type, 100)?.replace(/_/g, " ") ?? null,
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
    description: htmlToText(typeof job.description === "string" ? job.description : ""),
  });
  return parsed.success ? parsed.data : null;
}

export function createRemotiveSource(http: HttpJson, pauseMs?: number) {
  return createFeedSource({
    pauseMs,
    id: "remotive",
    parse: parseRemotiveJob,
    requests: () => [
      {
        label: "remote jobs",
        async load(signal) {
          const jobs = ((await http(new URL(API_URL), { signal })) as { jobs?: unknown })?.jobs;
          if (!Array.isArray(jobs)) throw new SourceError("Remotive returned an unexpected shape");
          return jobs;
        },
      },
    ],
  });
}
