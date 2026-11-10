import { type PostingInput, postingInputSchema, type SalaryPeriod } from "@copilot/shared";
import { htmlToText, httpUrl, num, plainMarkdown, regionList, str } from "../text";
import type { FetchContext } from "../types";
import { type ActorBoard, daysSince, windowFor } from "./actor-source";
import { RESULT_EVENT, START_EVENT } from "./apify";
import { parseLinkedInSalary } from "./linkedin";

// Boards read through Apify Store actors (pay per result, proxies included). Inputs and output
// shapes were checked with one tiny live run each on 2026-11-10 (docs/verification.md). The
// screen sorts out on-site roles elsewhere, so searches stay broad; cheap boards take every
// search phrase in one run.

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {});
const strings = (v: unknown, max = 100): string[] =>
  Array.isArray(v) ? v.flatMap((x) => (str(x, max) ? [str(x, max) as string] : [])) : [];

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
/** "GB" → "United Kingdom"; anything else unchanged. */
const placeName = (place: string) => {
  if (!/^[A-Z]{2}$/.test(place)) return place;
  try {
    return countryNames.of(place) ?? place;
  } catch {
    return place;
  }
};

/**
 * A long country list ("EMEA" expanded to ~130 codes) restricts nothing useful and would be cut
 * at the posting's region cap, dropping the countries that matter: treat it as not stated.
 */
const broadOrList = (places: string[]) => (places.length > 50 ? [] : places);

const date = (v: unknown): Date | null => {
  const s = str(v, 40);
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** A stated yearly range from free text ("$120K - $180K"); hourly or unclear pay gives null. */
export function yearlyPay(text: string | null) {
  const pay = parseLinkedInSalary(text);
  if (pay.min === null || pay.max === null) return null;
  if (pay.period !== "year" && !(pay.period === null && pay.min >= 10_000)) return null;
  return { min: pay.min, max: pay.max, currency: pay.currency };
}

const workplace = (type: string | null): boolean | null => {
  const t = type?.toLowerCase() ?? "";
  if (/remote/.test(t)) return true;
  if (/on-?site|office|hybrid/.test(t)) return false;
  return null;
};

const posting = (fields: Omit<PostingInput, "salaryPeriod"> & { salaryPeriod?: SalaryPeriod }) => {
  const parsed = postingInputSchema.safeParse({
    ...fields,
    salaryPeriod: fields.salaryPeriod ?? null,
  });
  return parsed.success ? parsed.data : null;
};

const pricesOf = (perResult: number, start = 0) => ({
  [RESULT_EVENT]: perResult,
  [START_EVENT]: start,
});

// --- YC Work at a Startup and Jobgether (same vendor, same input and row schema) -------------

/** One run for all search phrases; repeats are kept by us, not the actor's server-side dedupe. */
const nomadSearches = ({ settings, since }: FetchContext, limitPerSearch: number) => [
  {
    label: "all phrases",
    input: {
      schemaVersion: "nomad-agent-simple-inventory-search-v2",
      queries: settings.queries,
      postedWithin: `${daysSince(since)}d`,
      maxItems: Math.min(200, limitPerSearch * settings.queries.length),
      // Only remote roles: on-site ones (mostly the Bay Area) are screened out anyway.
      locationTypes: ["remote"],
      dedupe: { enabled: false, key: "" },
    },
  },
];

export function parseNomadRow(source: "ycombinator" | "jobgether") {
  return (raw: unknown): PostingInput | null => {
    const row = obj(raw);
    const id = str(row.id, 100);
    const url = httpUrl(row.url);
    if (!id || !url) return null;
    const remote = workplace(str(row.workType, 40));
    const pay = yearlyPay(str(row.salary, 200));
    const locations = strings(row.locations, 300);
    const html = typeof row.descriptionHtml === "string" ? row.descriptionHtml : "";
    return posting({
      source,
      externalId: id,
      url,
      applyUrl: null,
      title: str(row.title) ?? "",
      company: str(row.company, 200) ?? "",
      location: locations.join(" / ").slice(0, 300) || (remote ? "Remote" : null),
      remote,
      regions: remote ? broadOrList(strings(row.applicantLocations).map(placeName)) : [],
      salaryMin: pay?.min ?? null,
      salaryMax: pay?.max ?? null,
      salaryCurrency: pay?.currency ?? null,
      salaryPeriod: pay ? "year" : undefined,
      salaryText: str(row.salary, 200),
      seniority: null,
      employmentType: strings(row.employmentTypes).join(", ") || null,
      postedAt: date(row.postedAt),
      description: html
        ? htmlToText(html)
        : plainMarkdown(typeof row.description === "string" ? row.description : ""),
    });
  };
}

export const ycombinatorBoard: ActorBoard = {
  id: "ycombinator",
  actorId: "nomad-agent/ycombinator-was-scraper",
  prices: pricesOf(0.0001),
  searches: (context) =>
    nomadSearches(context, context.settings.sources.ycombinator.limitPerSearch),
  parse: parseNomadRow("ycombinator"),
};

export const jobgetherBoard: ActorBoard = {
  id: "jobgether",
  actorId: "nomad-agent/jobgether-scraper",
  prices: pricesOf(0.0001, 0.00005),
  searches: (context) => nomadSearches(context, context.settings.sources.jobgether.limitPerSearch),
  parse: parseNomadRow("jobgether"),
};

// --- Dice ------------------------------------------------------------------------------------

export function parseDiceItem(raw: unknown): PostingInput | null {
  const item = obj(raw);
  const id = str(item.jobId, 100) ?? str(item.id, 100);
  const url = httpUrl(item.detailsPageUrl) ?? httpUrl(item.url);
  if (!id || !url) return null;
  const setting = str(item.workSetting, 40) ?? strings(item.workplaceTypes).join(", ");
  const remote = item.isRemote === true ? true : workplace(setting);
  const location = str(item.location) ?? str(obj(item.jobLocation).displayName);
  const html = typeof item.description_html === "string" ? item.description_html : "";
  const text = typeof item.description_text === "string" ? item.description_text : "";
  return posting({
    source: "dice",
    externalId: id,
    url,
    applyUrl: null,
    title: str(item.title) ?? "",
    company: str(item.companyName, 200) ?? str(item.company, 200) ?? "",
    location: location ?? (remote ? "Remote" : null),
    remote,
    regions: [],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    // Dice pay is free text with mixed periods ("USD 9,719.00 per month"): kept as text only.
    salaryText: str(item.salary, 200),
    seniority: null,
    employmentType: str(item.employmentType, 100),
    postedAt: date(item.postedDate) ?? date(item.firstActiveDate),
    description: html
      ? htmlToText(html)
      : plainMarkdown(text || (typeof item.summary === "string" ? item.summary : "")),
  });
}

export const diceBoard: ActorBoard = {
  id: "dice",
  actorId: "shahidirfan/Dice-Job-Scraper",
  prices: pricesOf(0.001, 0.005),
  searches: ({ settings, since, backfill }) =>
    settings.queries.map((keyword) => ({
      label: `"${keyword}"`,
      input: {
        keyword,
        posted_date: { 1: "24h", 3: "3d", 7: "7d", 30: "30d" }[
          windowFor(since, backfill ? [1, 3, 7, 30] : [1, 3, 7])
        ],
        includeRemote: true,
        results_wanted: settings.sources.dice.limitPerSearch,
      },
    })),
  parse: parseDiceItem,
};

// --- Built In --------------------------------------------------------------------------------

export function parseBuiltInItem(raw: unknown): PostingInput | null {
  const item = obj(raw);
  const id = str(String(item.jobId ?? ""), 50);
  const url = httpUrl(item.jobUrl);
  if (!id || !url) return null;
  // `isRemote` is also true on hybrid roles: the workplace type decides.
  const remote = workplace(str(item.workplaceType, 40));
  const location = str(item.location);
  const min = num(item.salaryMin);
  const max = num(item.salaryMax);
  const yearly = str(item.salaryPeriod, 20)?.toLowerCase() === "year";
  const html = typeof item.descriptionHtml === "string" ? item.descriptionHtml : "";
  return posting({
    source: "builtin",
    externalId: id,
    url,
    applyUrl: httpUrl(item.applyUrl),
    title: str(item.title) ?? "",
    company: str(item.company, 200) ?? "",
    location: remote && location ? `Remote (${location})` : (location ?? null),
    remote,
    regions: remote ? regionList(location?.replace(/;/g, ",")) : [],
    // Currency is often missing (even for CAD), so the salary floor can't misjudge it.
    salaryMin: yearly ? min : null,
    salaryMax: yearly ? (max ?? min) : null,
    salaryCurrency: yearly ? str(item.salaryCurrency, 10) : null,
    salaryPeriod: yearly && min !== null ? "year" : undefined,
    salaryText: str(item.salaryText, 200),
    seniority: str(item.experienceLevel, 100),
    employmentType: str(item.employmentType, 100),
    postedAt: date(item.postedDate),
    description: html
      ? htmlToText(html)
      : plainMarkdown(typeof item.description === "string" ? item.description : ""),
  });
}

export const builtInBoard: ActorBoard = {
  id: "builtin",
  actorId: "solidcode/builtin-scraper",
  prices: pricesOf(0.00107, 0.00005),
  searches: ({ settings, since, backfill }) => [
    {
      label: "all phrases",
      input: {
        searchQueries: settings.queries,
        postedWithinDays: String(windowFor(since, backfill ? [1, 3, 7, 30] : [1, 3, 7])),
        maxResultsPerQuery: settings.sources.builtin.limitPerSearch,
        // Loose (hybrid roles still come back), but it drops most on-site ones we'd screen out.
        remoteMode: "remote",
        fetchDescription: true,
      },
    },
  ],
  parse: parseBuiltInItem,
};

// --- Wellfound -------------------------------------------------------------------------------

export function parseWellfoundItem(raw: unknown): PostingInput | null {
  const item = obj(raw);
  const id = str(String(item.id ?? ""), 50);
  const url = httpUrl(item.url);
  if (!id || !/^\d+$/.test(id) || !url) return null;
  const salary = obj(item.base_salary);
  const yearly = str(salary.unit, 20)?.toUpperCase() === "YEAR";
  const min = yearly ? num(salary.min_value) : null;
  const max = yearly ? num(salary.max_value) : null;
  const remote = typeof item.remote === "boolean" ? item.remote : null;
  const places = strings(item.location_names);
  const started = num(item.live_start_at);
  return posting({
    source: "wellfound",
    externalId: id,
    url,
    applyUrl: null,
    title: str(item.title) ?? "",
    company: str(item.company_name, 200) ?? "",
    location: places.join(", ").slice(0, 300) || (remote ? "Remote" : null),
    remote,
    // Location names on remote roles are unreliable; only the accepted-from list restricts.
    regions: remote ? strings(item.accepted_remote_location_names).slice(0, 100) : [],
    salaryMin: min,
    salaryMax: max ?? min,
    salaryCurrency: min !== null ? str(salary.currency, 10) : null,
    salaryPeriod: min !== null ? "year" : undefined,
    salaryText: str(item.compensation, 200),
    seniority: null,
    employmentType: str(item.job_type, 100),
    postedAt: started ? new Date(started * 1000) : null,
    description: plainMarkdown(typeof item.description === "string" ? item.description : ""),
  });
}

export const wellfoundBoard: ActorBoard = {
  id: "wellfound",
  actorId: "clearpath/wellfound-api-ppe",
  prices: pricesOf(0.0028, 0.00005),
  // No result limit: one page (~30 jobs) per role page, and the spend cap stops it.
  searches: ({ settings }) => [
    {
      label: "role pages",
      input: {
        urls: settings.sources.wellfound.roles.map((r) => `https://wellfound.com/role/r/${r}`),
        pageLimit: 1,
        onlyRemoteJobs: true,
      },
    },
  ],
  parse: parseWellfoundItem,
};

// --- HiringCafe ------------------------------------------------------------------------------

/** Some descriptions arrive URL-encoded (`%3Cp%3E…`). */
const decoded = (text: string) => {
  if (!/^%3C/i.test(text.trim())) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

export function parseHiringCafeItem(raw: unknown): PostingInput | null {
  const item = obj(raw);
  const info = obj(item.job_information);
  const data = obj(item.v5_processed_job_data);
  const id = str(item.id, 200);
  const requisition = str(item.requisition_id, 100);
  if (!id || !requisition || !/^[\w-]+$/.test(requisition)) return null;
  const remote = workplace(str(data.workplace_type, 40));
  const min = num(data.yearly_min_compensation);
  const max = num(data.yearly_max_compensation);
  const currency = str(data.listed_compensation_currency, 10);
  const html = typeof info.description === "string" ? decoded(info.description) : "";
  const text = typeof item.descriptionText === "string" ? decoded(item.descriptionText) : "";
  const location = str(data.formatted_workplace_location);
  const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return posting({
    source: "hiringcafe",
    externalId: id,
    url: `https://hiringcafe.com/job/${requisition}`,
    applyUrl: httpUrl(item.apply_url),
    title: str(info.title) ?? str(data.core_job_title) ?? "",
    company: str(data.company_name, 200) ?? str(obj(item.enriched_company_data).name, 200) ?? "",
    location: location ?? (remote ? "Remote" : null),
    remote,
    regions:
      remote && data.is_workplace_worldwide_ok === true
        ? ["Worldwide"]
        : remote
          ? strings(data.workplace_countries).map(placeName).slice(0, 100)
          : [],
    salaryMin: min,
    salaryMax: max ?? min,
    salaryCurrency: min !== null ? currency : null,
    salaryPeriod: min !== null ? "year" : undefined,
    salaryText:
      min !== null
        ? `${currency ?? ""} ${money(min)}${max ? `–${money(max)}` : ""} per year`.trim()
        : null,
    seniority: str(data.seniority_level, 100),
    employmentType: strings(data.commitment).join(", ") || null,
    postedAt: date(data.estimated_publish_date),
    description: html
      ? htmlToText(html)
      : text
        ? htmlToText(text)
        : plainMarkdown(
            typeof data.requirements_summary === "string" ? data.requirements_summary : "",
          ),
  });
}

export const hiringCafeBoard: ActorBoard = {
  id: "hiringcafe",
  actorId: "memo23/apify-hiring-cafe-scraper",
  prices: pricesOf(0.00125, 0.005),
  timeoutSecs: 600,
  searches: ({ settings, since }) =>
    settings.queries.map((keyword) => ({
      label: `"${keyword}"`,
      input: {
        keyword,
        workplaceType: "Remote",
        dateFetchedPastNDays: daysSince(since),
        sortBy: "date",
        maxItems: settings.sources.hiringcafe.limitPerSearch,
        enrichDescription: true,
      },
    })),
  parse: parseHiringCafeItem,
};

export const ACTOR_BOARDS = [
  ycombinatorBoard,
  jobgetherBoard,
  diceBoard,
  builtInBoard,
  wellfoundBoard,
  hiringCafeBoard,
] as const;
