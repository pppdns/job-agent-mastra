import { type PostingInput, postingInputSchema } from "@copilot/shared";
import { htmlToText, httpUrl, str } from "../text";
import { SourceError } from "../types";
import { createFeedSource } from "./feed";
import type { HttpJson } from "./http";

// Remote OK's public API (https://remoteok.com/api): the latest ~100 remote jobs, no search.
// Terms: link back to the job on Remote OK (followed) and name Remote OK as the source; the job
// page and the "via Remote OK" badge do both. The first array element is the legal notice.

const API_URL = "https://remoteok.com/api";

const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Remote OK's salary fields are often 0 or garbage: keep only a plausible yearly USD range. */
export function remoteOkSalary(minRaw: unknown, maxRaw: unknown) {
  const min = Number(minRaw);
  const max = Number(maxRaw);
  const ok = (n: number) => Number.isFinite(n) && n >= 10_000 && n <= 1_000_000;
  if (!ok(min) || !ok(max) || min > max) return null;
  return { min, max, text: `USD ${money(min)}–${money(max)} per year` };
}

const isRemoteOk = (url: string) => /^https?:\/\/(www\.)?remoteok\.(com|io)\//i.test(url);

export function parseRemoteOkJob(raw: unknown): PostingInput | null {
  if (!raw || typeof raw !== "object") return null;
  const job = raw as Record<string, unknown>;
  const id = str(String(job.id ?? ""), 50);
  const slug = str(job.slug, 300);
  if (!id || !/^\d+$/.test(id) || !slug) return null;
  const salary = remoteOkSalary(job.salary_min, job.salary_max);
  const location = str(job.location);
  const apply = httpUrl(job.apply_url);
  const epoch = Number(job.epoch);
  const parsed = postingInputSchema.safeParse({
    source: "remoteok",
    externalId: id,
    url: `https://remoteok.com/remote-jobs/${encodeURIComponent(slug)}`,
    applyUrl: apply && !isRemoteOk(apply) ? apply : null,
    title: str(job.position),
    company: str(job.company, 200),
    location: location ? `Remote (${location})` : "Remote",
    remote: true,
    // Locations are free text (cities, states, "EMEA"): only "worldwide" is trusted as a region.
    regions: location && /\b(worldwide|anywhere)\b/i.test(location) ? ["Worldwide"] : [],
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    salaryCurrency: salary ? "USD" : null,
    salaryPeriod: salary ? "year" : null,
    salaryText: salary?.text ?? null,
    seniority: null,
    employmentType: null,
    postedAt: Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000) : null,
    description: htmlToText(typeof job.description === "string" ? job.description : ""),
  });
  return parsed.success ? parsed.data : null;
}

export function createRemoteOkSource(http: HttpJson, pauseMs?: number) {
  return createFeedSource({
    pauseMs,
    id: "remoteok",
    parse: parseRemoteOkJob,
    requests: () => [
      {
        label: "latest jobs",
        async load(signal) {
          const body = await http(new URL(API_URL), { signal });
          if (!Array.isArray(body)) throw new SourceError("Remote OK returned an unexpected shape");
          // Skip the legal notice (an element without a job id).
          return body.filter((item) => item && typeof item === "object" && "id" in item);
        },
      },
    ],
  });
}
