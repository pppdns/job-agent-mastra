import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findWorkspaceRoot } from "@copilot/db";
import { DEFAULT_SEARCH_SETTINGS, type SearchSettings } from "@copilot/shared";
import { describe, expect, it } from "vitest";
import type { FetchContext } from "../types";
import { CooldownError, SourceError } from "../types";
import { type ApifyRunner, createApifyRunner, runCost } from "./apify";
import { createHimalayasSource, parseHimalayasJob } from "./himalayas";
import type { HttpJson } from "./http";
import {
  createLinkedInSource,
  datePostedFor,
  LINKEDIN_PRICES,
  linkedInSearches,
  parseLinkedInItem,
  parseLinkedInSalary,
} from "./linkedin";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(findWorkspaceRoot(), "fixtures/sources", name), "utf8"));

const settings = (over: Partial<SearchSettings> = {}): SearchSettings => ({
  ...DEFAULT_SEARCH_SETTINGS,
  ...over,
});

const context = (over: Partial<FetchContext> = {}): FetchContext => ({
  settings: settings({ queries: ["Founding Engineer"] }),
  since: new Date(0),
  backfill: false,
  knownIds: [],
  maxUsd: 0.5,
  ...over,
});

describe("Himalayas", () => {
  const jobs = fixture("himalayas-search.json").jobs as unknown[];

  it("maps API jobs to postings: remote, regions, pay, date, plain description", () => {
    const posting = parseHimalayasJob(jobs[0]);
    expect(posting).toMatchObject({
      source: "himalayas",
      title: "Founding Engineer",
      company: "Quillfeather Health",
      remote: true,
      regions: ["Germany", "Portugal"],
      location: "Remote (Germany, Portugal)",
      salaryMin: 90_000,
      salaryMax: 120_000,
      salaryCurrency: "EUR",
      salaryPeriod: "year",
      salaryText: "EUR 90,000–120,000 per year",
      seniority: "Senior",
    });
    expect(posting?.description).toContain("TypeScript, React and Node.js");
    expect(posting?.description).not.toContain("example.com");
    expect(parseHimalayasJob(jobs[1])).toMatchObject({ regions: [], salaryText: null });
    expect(parseHimalayasJob(jobs[4])).toBeNull();
  });

  it("pages per query until a page is older than `since`, and dedupes across queries", async () => {
    const calls: string[] = [];
    const http: HttpJson = async (url) => {
      calls.push(`${url.searchParams.get("q")}#${url.searchParams.get("page")}`);
      const page = Number(url.searchParams.get("page"));
      const pubDate = page === 1 ? 2_000_000_000 : 1_000;
      return { jobs: jobs.slice(0, 2).map((j) => ({ ...(j as object), pubDate })) };
    };
    const source = createHimalayasSource(http, undefined, 0);
    const result = await source.fetch(
      context({
        settings: settings({ queries: ["a", "b"] }),
        since: new Date(1_500_000_000_000),
      }),
    );
    expect(calls).toEqual(["a#1", "a#2", "b#1", "b#2"]);
    expect(result.postings).toHaveLength(2);
    expect(result.partial).toBeUndefined();
  });

  it("stops every search once rate limited for longer than it retries", async () => {
    const asked: string[] = [];
    const limited: HttpJson = async (url) => {
      asked.push(url.searchParams.get("q") ?? "");
      if (asked.length === 1)
        return {
          jobs: jobs.slice(0, 1).map((j) => ({ ...(j as object), pubDate: 2_000_000_000 })),
        };
      throw new CooldownError("himalayas.app is rate limiting (asked to wait 120 s)");
    };
    const result = await createHimalayasSource(limited, undefined, 0).fetch(
      context({ settings: settings({ queries: ["a", "b", "c", "d"] }), since: new Date(0) }),
    );
    // Page 1 of "a" worked, page 2 of "a" hit the cooldown: "b", "c" and "d" were never asked.
    expect(asked).toEqual(["a", "a"]);
    expect(result.postings).toHaveLength(1);
    expect(result.failures).toEqual(['"a": himalayas.app is rate limiting (asked to wait 120 s)']);
  });

  it("reports some failed searches as partial and all failed as an error", async () => {
    const flaky: HttpJson = async (url) => {
      if (url.searchParams.get("q") === "bad") throw new SourceError("himalayas.app answered 400");
      return { jobs: [] };
    };
    const partial = await createHimalayasSource(flaky, undefined, 0).fetch(
      context({ settings: settings({ queries: ["good", "bad"] }) }),
    );
    expect(partial.partial).toContain('"bad": himalayas.app answered 400');
    await expect(
      createHimalayasSource(flaky, undefined, 0).fetch(
        context({ settings: settings({ queries: ["bad"] }) }),
      ),
    ).rejects.toThrow("every search failed");
  });
});

describe("LinkedIn (Apify)", () => {
  const items = fixture("linkedin-items.json") as unknown[];

  it("maps dataset items: canonical URL, pay, unknown remote, apply URL", () => {
    expect(parseLinkedInItem(items[0])).toMatchObject({
      externalId: "4400000001",
      url: "https://www.linkedin.com/jobs/view/4400000001/",
      company: "Quillfeather Health GmbH",
      remote: null,
      salaryMin: 90_000,
      salaryMax: 120_000,
      salaryCurrency: "EUR",
      salaryPeriod: "year",
      applyUrl: null,
    });
    expect(parseLinkedInItem(items[1])).toMatchObject({
      applyUrl: "https://jobs.ashbyhq.com/tidewater-robotics/0001",
      description: "Lead a team of six engineers building warehouse robots. Hybrid in Budapest.",
    });
    expect(parseLinkedInItem(items[3])).toBeNull();
  });

  it("parses LinkedIn pay strings", () => {
    expect(parseLinkedInSalary("$97,000.00/yr - $170,000.00/yr")).toEqual({
      min: 97_000,
      max: 170_000,
      currency: "USD",
      period: "year",
    });
    expect(parseLinkedInSalary("€45.00/hr")).toMatchObject({ min: 45, period: "hour" });
    expect(parseLinkedInSalary("")).toMatchObject({ min: null });
  });

  it("builds one search per query and location with the right posting window", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const s = settings({ queries: ["AI Engineer", "Founding Engineer"] });
    const searches = linkedInSearches(
      s,
      { since: new Date("2026-11-10T00:00:00Z"), backfill: false, knownIds: ["1", "2"] },
      now,
    );
    expect(searches).toHaveLength(2 * s.sources.linkedin.locations.length);
    expect(searches[0]).toMatchObject({
      keywords: "AI Engineer",
      location: "European Union",
      datePosted: "r86400",
      limit: 50,
      skipJobId: ["1", "2"],
      titleExclude: s.titleExclude,
    });
    expect(datePostedFor(new Date("2026-11-05T00:00:00Z"), false, now)).toBe("r604800");
    expect(datePostedFor(new Date("2026-10-27T00:00:00Z"), false, now)).toBe("r604800");
    expect(datePostedFor(new Date("2026-10-11T00:00:00Z"), true, now)).toBe("r2592000");
    const backfill = linkedInSearches(s, { since: now, backfill: true, knownIds: [] }, now);
    expect(backfill[0]?.limit).toBe(200);
  });

  it("stops searching once the per-run cap is spent", async () => {
    let runs = 0;
    const runner: ApifyRunner = async () => {
      runs += 1;
      return { items: items.slice(0, 2), costUsd: 0.3 };
    };
    const result = await createLinkedInSource(runner).fetch(
      context({ settings: settings({ queries: ["a", "b", "c"] }), maxUsd: 0.5 }),
    );
    expect(runs).toBe(2);
    expect(result.costUsd).toBeCloseTo(0.6);
    expect(result.postings).toHaveLength(2);
    expect(result.partial).toContain("spend cap reached");
    expect(result.failures).toEqual([]);
  });

  it("separates failed searches from cap stops, and stops at a cooldown", async () => {
    let runs = 0;
    const runner: ApifyRunner = async () => {
      runs += 1;
      if (runs === 1) return { items: items.slice(0, 2), costUsd: 0.01 };
      throw new CooldownError("api.apify.com is rate limiting (asked to wait 300 s)");
    };
    const result = await createLinkedInSource(runner).fetch(
      context({ settings: settings({ queries: ["a", "b", "c"] }) }),
    );
    expect(runs).toBe(2);
    expect(result.postings).toHaveLength(2);
    expect(result.failures).toEqual([
      '"a" in United States: api.apify.com is rate limiting (asked to wait 300 s)',
    ]);
  });

  it("is unavailable without an Apify key and fails fast on 402", async () => {
    expect(createLinkedInSource(null).unavailable()).toBe("APIFY_API_KEY is not set");
    const broke: ApifyRunner = async () => {
      throw new SourceError("Apify refused the run (402: usage limit or plan exhausted)");
    };
    await expect(createLinkedInSource(broke).fetch(context())).rejects.toThrow("402");
  });
});

describe("Apify runner", () => {
  const run = (status: string, extra = {}) => ({
    data: { id: "run1", status, defaultDatasetId: "ds1", ...extra },
  });

  it("starts with a spend cap, waits, reads the dataset and estimates cost", async () => {
    const urls: string[] = [];
    const http: HttpJson = async (url, init) => {
      urls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
      if (url.pathname.endsWith("/runs")) return run("RUNNING");
      if (url.pathname.includes("/actor-runs/"))
        return run("SUCCEEDED", {
          chargedEventCounts: { "apify-default-dataset-item": 2, "apify-actor-start": 1 },
        });
      return [{ id: "1" }, { id: "2" }];
    };
    const result = await createApifyRunner(http, "token")(
      "valig/linkedin-jobs-scraper",
      {},
      {
        maxUsd: 0.5,
        timeoutSecs: 60,
        prices: LINKEDIN_PRICES,
      },
    );
    expect(urls[0]).toMatch(
      /^POST \/v2\/acts\/valig~linkedin-jobs-scraper\/runs\?maxTotalChargeUsd=0\.50/,
    );
    expect(result.items).toHaveLength(2);
    expect(result.costUsd).toBeCloseTo(2 * 0.00036 + 0.0009);
    expect(result.partial).toBeUndefined();
  });

  it("fails a FAILED run, keeps items of a timed-out one, names a 402", async () => {
    const failing: HttpJson = async () => run("FAILED");
    const runner = createApifyRunner(failing, "t");
    const options = { maxUsd: 1, timeoutSecs: 60, prices: LINKEDIN_PRICES };
    await expect(runner("a/b", {}, options)).rejects.toThrow("failed");

    const timedOut: HttpJson = async (url) =>
      url.pathname.includes("/datasets/") ? [{ id: "1" }] : run("TIMED-OUT");
    expect((await createApifyRunner(timedOut, "t")("a/b", {}, options)).partial).toContain(
      "timed-out",
    );

    const broke: HttpJson = async () => {
      throw new SourceError("api.apify.com answered 402");
    };
    await expect(createApifyRunner(broke, "t")("a/b", {}, options)).rejects.toThrow("usage limit");
  });

  it("aborts the actor run when it is stopped while waiting", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const http: HttpJson = async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname.endsWith("/runs")) return run("RUNNING");
      if (url.pathname.endsWith("/abort")) {
        expect(init?.signal).toBeUndefined();
        return run("ABORTED");
      }
      controller.abort();
      throw new Error("aborted");
    };
    const options = { maxUsd: 1, timeoutSecs: 60, prices: LINKEDIN_PRICES };
    await expect(
      createApifyRunner(http, "t")("a/b", {}, { ...options, signal: controller.signal }),
    ).rejects.toThrow("aborted");
    expect(calls.at(-1)).toBe("POST /v2/actor-runs/run1/abort");
  });

  it("takes Apify's reported cost, else the run's event prices, else ours", () => {
    const counts = { "apify-default-dataset-item": 200, "apify-actor-start": 1 };
    expect(runCost({ usageTotalUsd: 0.5, chargedEventCounts: counts }, LINKEDIN_PRICES, 200)).toBe(
      0.5,
    );
    // Read right after the run: usage still shows only the start fee.
    expect(
      runCost({ usageTotalUsd: 0.001, chargedEventCounts: counts }, { ...LINKEDIN_PRICES }, 200),
    ).toBeCloseTo(200 * 0.00036 + 0.0009);
    // The result count can lag too (Career Sites on Fly): every item read is billed.
    expect(
      runCost(
        {
          usageTotalUsd: 0.001,
          chargedEventCounts: { "apify-default-dataset-item": 0, "apify-actor-start": 1 },
        },
        LINKEDIN_PRICES,
        200,
      ),
    ).toBeCloseTo(200 * 0.00036 + 0.0009);
    expect(
      runCost(
        {
          chargedEventCounts: { "apify-default-dataset-item": 50, "apify-actor-start": 1 },
          pricingInfo: {
            pricingPerEvent: {
              actorChargeEvents: { "apify-default-dataset-item": { eventPriceUsd: 0.001 } },
            },
          },
        },
        LINKEDIN_PRICES,
        50,
      ),
    ).toBeCloseTo(50 * 0.001 + 0.0009);
    expect(runCost({}, LINKEDIN_PRICES, 10)).toBeCloseTo(10 * 0.00036 + 0.0009);
  });
});
