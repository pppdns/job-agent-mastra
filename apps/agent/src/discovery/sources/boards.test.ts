import { DEFAULT_SEARCH_SETTINGS, screenPosting } from "@copilot/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FetchContext, SourceError } from "../types";
import { createActorSource, windowFor } from "./actor-source";
import type { ApifyRunner } from "./apify";
import {
  agoDate,
  builtInBoard,
  careerSitesBoard,
  diceBoard,
  hiringCafeBoard,
  jobgetherBoard,
  parseBuiltInItem,
  parseCareerSiteItem,
  parseDiceItem,
  parseHiringCafeItem,
  parseJobgetherItem,
  parseWellfoundItem,
  parseYcJob,
  wellfoundBoard,
  YC_REMOTE_JOBS_URL,
  ycombinatorBoard,
  yearlyPay,
} from "./boards";

// Synthetic items shaped like each actor's live output (field names from one tiny run each).

const now = new Date("2026-11-10T12:00:00Z");
const context = (over: Partial<FetchContext> = {}): FetchContext => ({
  settings: DEFAULT_SEARCH_SETTINGS,
  since: new Date("2026-11-09T11:00:00Z"),
  backfill: false,
  knownIds: [],
  maxUsd: 0.1,
  ...over,
});

describe("inputs", () => {
  it("asks each board for the window since the last good run", () => {
    expect(windowFor(new Date("2026-11-09T11:00:00Z"), [1, 3, 7], now)).toBe(3);
    expect(windowFor(new Date("2026-11-09T13:00:00Z"), [1, 3, 7], now)).toBe(1);
    expect(windowFor(new Date("2026-10-01T00:00:00Z"), [1, 3, 7], now)).toBe(7);
    expect(ycombinatorBoard.searches(context())).toEqual([
      {
        label: "remote software engineering jobs",
        input: { startUrls: [YC_REMOTE_JOBS_URL], maxItems: 50 },
      },
    ]);
    const jobgether = jobgetherBoard.searches(context());
    expect(jobgether).toHaveLength(DEFAULT_SEARCH_SETTINGS.queries.length);
    expect(jobgether[0]).toMatchObject({
      label: '"Applied AI Engineer"',
      input: { keyword: "Applied AI Engineer", includeDetails: true, maxItems: 50 },
    });
    expect(diceBoard.searches(context())).toHaveLength(DEFAULT_SEARCH_SETTINGS.queries.length);
    expect(diceBoard.searches(context())[0]?.input).toMatchObject({
      keyword: "Applied AI Engineer",
      includeRemote: true,
      results_wanted: 25,
    });
    expect(builtInBoard.searches(context())[0]?.input).toMatchObject({
      searchQueries: DEFAULT_SEARCH_SETTINGS.queries,
      maxResultsPerQuery: 25,
    });
    expect(wellfoundBoard.searches(context())[0]?.input).toMatchObject({
      urls: [
        "https://wellfound.com/role/r/ai-engineer",
        "https://wellfound.com/role/r/full-stack-engineer",
        "https://wellfound.com/role/r/engineering-manager",
      ],
      pageLimit: 1,
      onlyRemoteJobs: true,
    });
    expect(hiringCafeBoard.searches(context())[0]?.input).toMatchObject({
      keyword: "Applied AI Engineer",
      workplaceType: "Remote",
      maxItems: 25,
    });
  });

  it("reads only yearly pay from free text", () => {
    expect(yearlyPay("$120K - $180K")).toEqual({ min: 120_000, max: 180_000, currency: "USD" });
    expect(yearlyPay("$60.00 - $70.00")).toBeNull();
    expect(yearlyPay("Depends on Experience")).toBeNull();
  });
});

const ycItem = {
  title: "Design Engineer",
  companyName: "Entangl",
  jobType: "Full-time",
  location: "San Francisco, CA, US / London, England, GB / Remote (US; London, England, GB)",
  salaryMin: 120_000,
  salaryMax: 180_000,
  salaryCurrency: "USD",
  salaryRange: "$120K - $180K",
  postedAgo: "6 days",
  datePosted: "2026-03-01T10:00:00Z",
  applyUrl:
    "https://account.ycombinator.com/authenticate?continue=https%3A%2F%2Fwww.workatastartup.com%2Fapplication%3Fsignup_job_id%3D121173&defaults%5BsignUpActive%5D=true",
  url: "https://www.ycombinator.com/companies/entangl/jobs/CJBPxvX-design-engineer",
  jobId: "CJBPxvX-design-engineer",
  descriptionHtml: "<p>Build the <a href='https://x.example'>editor</a>.</p>",
  scrapedAt: "2026-11-10T12:00:00Z",
};

describe("YC Work at a Startup", () => {
  it("maps items under the numeric WaaS id, with regions from the remote part", () => {
    expect(parseYcJob(ycItem)).toMatchObject({
      source: "ycombinator",
      externalId: "121173",
      url: "https://www.workatastartup.com/jobs/121173",
      applyUrl: null,
      remote: true,
      regions: ["United States", "United Kingdom"],
      salaryMin: 120_000,
      salaryMax: 180_000,
      salaryCurrency: "USD",
      salaryPeriod: "year",
      employmentType: "Full-time",
      // Last active 6 days before the scrape, not the months-old creation date.
      postedAt: new Date("2026-11-04T12:00:00Z"),
      description: "Build the editor.",
    });
    // Without the sign-up link: the slug id and the YC page.
    expect(parseYcJob({ ...ycItem, applyUrl: null })).toMatchObject({
      externalId: "CJBPxvX-design-engineer",
      url: ycItem.url,
    });
    expect(parseYcJob({ ...ycItem, applyUrl: null, url: "javascript:x" })).toBeNull();
    // Monthly pay stays text; a bare "Remote" states no regions.
    expect(
      parseYcJob({
        ...ycItem,
        location: "Remote",
        salaryMin: 4_000,
        salaryRange: "$4K - $8K / monthly",
      }),
    ).toMatchObject({ regions: [], salaryMin: null, salaryText: "$4K - $8K / monthly" });
  });

  it("reads YC's relative times", () => {
    const base = new Date("2026-11-10T12:00:00Z");
    expect(agoDate("27 minutes", base)).toEqual(new Date("2026-11-10T11:33:00Z"));
    expect(agoDate("about 1 month", base)).toEqual(new Date("2026-10-11T12:00:00Z"));
    expect(agoDate("an hour", base)).toEqual(new Date("2026-11-10T11:00:00Z"));
    expect(agoDate("less than a minute", base)).toEqual(base);
    expect(agoDate("soon", base)).toBeNull();
    expect(agoDate("6 days", null)).toBeNull();
  });

  it("screens an on-site role elsewhere out, a remote one from the UK through", () => {
    const remote = parseYcJob(ycItem);
    const onsite = parseYcJob({ ...ycItem, location: "San Francisco, CA, US" });
    expect(remote && screenPosting(DEFAULT_SEARCH_SETTINGS, remote, now).pass).toBe(true);
    expect(onsite && screenPosting(DEFAULT_SEARCH_SETTINGS, onsite, now).reasons).toEqual([
      "not remote, in San Francisco, CA, US",
    ]);
  });
});

describe("Jobgether", () => {
  const item = {
    offerId: "6af6aeb2081ddfee5005a119",
    title: "Staff AI Engineer, Agentic Systems",
    company: "Clearer.io",
    postedAt: "2026-11-09T06:31:14.406Z",
    remoteScope: "Remote",
    locations: ["DE", "PL", "HU", "Germany", "Europe"],
    salaryMin: 90_000,
    salaryMax: 100_000,
    salaryCurrency: "GBP",
    salaryPeriod: "YEAR",
    canonicalUrl:
      "https://jobgether.com/offer/6af6aeb2081ddfee5005a119-staff-ai-engineer-agentic-systems",
    applyUrl: "https://jobgether.com/auto-apply",
    employmentTypes: ["FULL_TIME"],
    description: "This a Full Remote job, the offer is available from: Europe. Build agents.",
  };

  it("maps items: country codes as names without repeats, yearly pay, no auto-apply link", () => {
    expect(parseJobgetherItem(item)).toMatchObject({
      source: "jobgether",
      externalId: "6af6aeb2081ddfee5005a119",
      url: item.canonicalUrl,
      applyUrl: null,
      remote: true,
      regions: ["Germany", "Poland", "Hungary", "Europe"],
      salaryMin: 90_000,
      salaryMax: 100_000,
      salaryCurrency: "GBP",
      salaryPeriod: "year",
      salaryText: "GBP 90,000–100,000 per year",
      employmentType: "FULL_TIME",
      postedAt: new Date("2026-11-09T06:31:14.406Z"),
    });
    expect(
      parseJobgetherItem({ ...item, applyUrl: "https://boards.greenhouse.io/x/jobs/1" })?.applyUrl,
    ).toBe("https://boards.greenhouse.io/x/jobs/1");
    expect(parseJobgetherItem({ ...item, canonicalUrl: "javascript:x" })).toBeNull();
    // An "EMEA" list of ~130 country codes restricts nothing useful.
    const emea = Array.from({ length: 130 }, (_, i) => `C${i}`);
    expect(parseJobgetherItem({ ...item, locations: emea })?.regions).toEqual([]);
  });
});

describe("Dice", () => {
  it("maps items with pay as text only", () => {
    expect(
      parseDiceItem({
        id: "02a57c8c",
        jobId: "02a57c8c",
        title: "AI Engineer 4",
        companyName: "Capital One",
        jobLocation: { displayName: "McLean, Virginia, USA" },
        postedDate: "2026-11-08T11:40:18Z",
        detailsPageUrl: "https://www.dice.com/job-detail/85494e1a",
        isRemote: false,
        workSetting: "On-Site",
        employmentType: "Full-time",
        salary: "USD 9,719.00 per month",
        description_html: "<p>Build AI systems.</p>",
      }),
    ).toMatchObject({
      source: "dice",
      externalId: "02a57c8c",
      location: "McLean, Virginia, USA",
      remote: false,
      salaryMax: null,
      salaryText: "USD 9,719.00 per month",
      description: "Build AI systems.",
    });
  });
});

describe("Built In", () => {
  it("decides remote by workplace type and keeps pay without a currency", () => {
    const item = {
      jobId: "12161377",
      title: "Software Engineer II, Back-end, (AI Agents)",
      jobUrl: "https://builtin.com/job/software-engineer-ii/12161377",
      company: "Affirm",
      location: "Canada",
      isRemote: true,
      workplaceType: "Hybrid",
      experienceLevel: "Junior",
      salaryText: "133K-183K Annually",
      salaryMin: 133_000,
      salaryMax: 183_000,
      salaryCurrency: null,
      salaryPeriod: "year",
      postedDate: "2026-11-10",
      description: "Agents for payments.",
    };
    expect(parseBuiltInItem(item)).toMatchObject({
      remote: false,
      regions: [],
      salaryMax: 183_000,
      salaryCurrency: null,
      seniority: "Junior",
      postedAt: new Date("2026-11-10T00:00:00Z"),
    });
    expect(parseBuiltInItem({ ...item, workplaceType: "Remote" })).toMatchObject({
      remote: true,
      location: "Remote (Canada)",
      regions: ["Canada"],
    });
  });
});

describe("Wellfound", () => {
  it("maps items: yearly base salary, unix start date, no regions from odd location names", () => {
    expect(
      parseWellfoundItem({
        id: "4884639",
        title: "AI Engineer",
        company_name: "MiPrep AI",
        job_type: "full-time",
        remote: true,
        location_names: ["Anykščiai"],
        compensation: "$40k – $60k",
        base_salary: { currency: "USD", unit: "YEAR", min_value: 40_000, max_value: 60_000 },
        live_start_at: 1792769947,
        url: "https://wellfound.com/company/miprep-ai/jobs/ai-engineer",
        description: "## About\n\nInterview copilot.",
      }),
    ).toMatchObject({
      source: "wellfound",
      remote: true,
      regions: [],
      salaryMin: 40_000,
      salaryCurrency: "USD",
      postedAt: new Date(1792769947 * 1000),
    });
  });
});

describe("HiringCafe", () => {
  const item = {
    id: "grnhse___hops___5290677007",
    apply_url: "https://job-boards.greenhouse.io/hops/jobs/5290677007",
    requisition_id: "bii6hlgnazijhbgv",
    job_information: { title: "Forward Deployed Engineer" },
    descriptionText: "%3Cp%3EWork%20with%20customers.%3C%2Fp%3E",
    v5_processed_job_data: {
      company_name: "Hops",
      formatted_workplace_location: "United States",
      workplace_type: "Remote",
      is_workplace_worldwide_ok: false,
      workplace_countries: ["US"],
      yearly_min_compensation: 150_000,
      yearly_max_compensation: 190_000,
      listed_compensation_currency: "USD",
      seniority_level: "Mid Level",
      commitment: ["Full Time"],
      estimated_publish_date: "2026-11-10T13:21:37.000Z",
      requirements_summary: "3+ years in solutions engineering.",
    },
  };

  it("maps items: board link, ATS apply link, URL-encoded descriptions, summary fallback", () => {
    expect(parseHiringCafeItem(item)).toMatchObject({
      url: "https://hiringcafe.com/job/bii6hlgnazijhbgv",
      applyUrl: "https://job-boards.greenhouse.io/hops/jobs/5290677007",
      company: "Hops",
      remote: true,
      regions: ["United States"],
      salaryText: "USD 150,000–190,000 per year",
      description: "Work with customers.",
    });
    expect(parseHiringCafeItem({ ...item, descriptionText: undefined })?.description).toBe(
      "3+ years in solutions engineering.",
    );
    expect(parseHiringCafeItem({ ...item, requisition_id: "../x" })).toBeNull();
  });
});

describe("Company career sites", () => {
  const item = {
    id: 2459270789,
    date_posted: "2026-11-10T11:55:40.183",
    title: "Senior Forward Deployed AI Engineer",
    organization: "Fernhollow AI GmbH",
    url: "https://fernhollow.jobs.personio.com/job/2882669",
    locations_derived: ["Karlsruhe, Baden-Württemberg, Germany"],
    ai_work_arrangement: "Remote OK",
    ai_remote_location_derived: ["Germany"],
    ai_salary_currency: "EUR",
    ai_salary_min_value: 75_000,
    ai_salary_max_value: 95_000,
    ai_salary_unit_text: "YEAR",
    ai_experience_level: "5-10",
    ai_employment_type: ["FULL_TIME"],
    description_text: "Lead customer projects. [More](https://x.example)",
  };

  it("maps items: ATS URL as apply link, AI-read pay and remote region, zone-less UTC dates", () => {
    expect(parseCareerSiteItem(item)).toMatchObject({
      source: "careersites",
      externalId: "2459270789",
      applyUrl: "https://fernhollow.jobs.personio.com/job/2882669",
      company: "Fernhollow AI GmbH",
      remote: true,
      regions: ["Germany"],
      location: "Remote (Germany)",
      salaryMin: 75_000,
      salaryMax: 95_000,
      salaryPeriod: "year",
      salaryText: "EUR 75,000–95,000 per year",
      seniority: "5-10 years",
      employmentType: "FULL_TIME",
      postedAt: new Date("2026-11-10T11:55:40.183Z"),
      description: "Lead customer projects. More",
    });
    expect(parseCareerSiteItem({ ...item, ai_work_arrangement: "Hybrid" })).toMatchObject({
      remote: false,
      regions: [],
      location: "Karlsruhe, Baden-Württemberg, Germany",
    });
    expect(parseCareerSiteItem({ ...item, url: "ftp://x" })).toBeNull();
  });

  it("asks for remote roles by title without agencies or Jobgether, one posting per title", async () => {
    expect(careerSitesBoard.searches(context())[0]?.input).toMatchObject({
      limit: 200,
      titleSearch: DEFAULT_SEARCH_SETTINGS.queries,
      titleExclusionSearch: DEFAULT_SEARCH_SETTINGS.titleExclude,
      organizationExclusionSearch: ["Jobgether"],
      aiWorkArrangementFilter: ["Remote OK", "Remote Solely"],
      removeAgency: true,
    });
    // The same role listed once per office becomes one posting: an eligible office wins over an
    // earlier one the screen would drop.
    const india = { ...item, id: 1, ai_remote_location_derived: ["India"] };
    const runner: ApifyRunner = async () => ({
      items: [
        india,
        item,
        { ...item, id: 2, locations_derived: ["Berlin"] },
        { ...item, id: 3, title: "Other" },
      ],
      costUsd: 0.4,
    });
    const outcome = await createActorSource(careerSitesBoard, runner).fetch(
      context({ maxUsd: 0.45 }),
    );
    expect(outcome.postings.map((p) => p.externalId)).toEqual(["2459270789", "3"]);
  });
});

describe("actor sources", () => {
  const row = (id: string, postedAgo: string) => ({
    ...ycItem,
    applyUrl: `https://www.workatastartup.com/application?signup_job_id=${id}`,
    postedAgo,
  });

  it("runs each search within the spend cap and keeps every valid item", async () => {
    const calls: unknown[] = [];
    const runner: ApifyRunner = async (actorId, input, { maxUsd }) => {
      calls.push({ actorId, input, maxUsd });
      return {
        items: [row("1", "1 day"), row("2", "9 days"), {}],
        costUsd: 0.03,
        runId: `run-${calls.length}`,
        datasetId: `ds-${calls.length}`,
      };
    };
    const outcome = await createActorSource(diceBoard, runner).fetch(context({ maxUsd: 0.07 }));
    // Dice's parser rejects these YC-shaped rows: this part only checks the spend cap.
    expect(calls).toHaveLength(3);
    expect(outcome.costUsd).toBeCloseTo(0.09);
    expect(outcome.partial).toBe("spend cap reached after 0.09 USD");
    const yc = await createActorSource(ycombinatorBoard, runner).fetch(context());
    expect(yc.postings.map((p) => p.externalId)).toEqual(["1", "2"]);
    expect(yc.invalid).toBe(1);
    expect(yc.providerRuns).toEqual([
      { label: "remote software engineering jobs", runId: "run-4", datasetId: "ds-4" },
    ]);
    expect(yc.raw).toEqual({
      invalid: [{}],
      sample: [
        expect.objectContaining({ postedAgo: "1 day" }),
        expect.objectContaining({ postedAgo: "9 days" }),
      ],
    });
  });

  it("reports a source whose searches all came back empty, but not a quiet single search", async () => {
    const empty: ApifyRunner = async () => ({ items: [], costUsd: 0.005 });
    const dice = await createActorSource(diceBoard, empty).fetch(context({ maxUsd: 1 }));
    const searches = DEFAULT_SEARCH_SETTINGS.queries.length;
    expect(dice.failures).toEqual([`every search came back empty (${searches} searches)`]);
    expect(dice.partial).toBe(`every search came back empty (${searches} searches)`);
    const yc = await createActorSource(ycombinatorBoard, empty).fetch(context());
    expect(yc.failures).toEqual([]);
    expect(yc.partial).toBeUndefined();
    // The actor said nothing matched (a FAILED run taken as empty): a quiet window, no problem.
    const confirmed: ApifyRunner = async () => ({ items: [], costUsd: 0.005, status: "FAILED" });
    const jobgether = await createActorSource(jobgetherBoard, confirmed).fetch(
      context({ maxUsd: 1 }),
    );
    expect(jobgether.failures).toEqual([]);
    expect(jobgether.partial).toBeUndefined();
  });

  afterEach(() => vi.restoreAllMocks());

  it("runs a stalled Jobgether search again once, and names the search of a partial run", async () => {
    const calls: number[] = [];
    // The first search stalls twice, the second once, the rest succeed.
    const stalls = new Map([
      [0, 2],
      [1, 1],
    ]);
    const runner: ApifyRunner = async (_actor, input, { timeoutSecs }) => {
      calls.push(timeoutSecs);
      const index = DEFAULT_SEARCH_SETTINGS.queries.indexOf((input as { keyword: string }).keyword);
      const left = stalls.get(index) ?? 0;
      if (left > 0) {
        stalls.set(index, left - 1);
        return {
          items: [],
          costUsd: 0.005,
          status: "TIMED-OUT",
          partial: "Apify run timed-out, kept 0 items",
        };
      }
      return { items: [], costUsd: 0.005, status: "SUCCEEDED" };
    };
    const total = DEFAULT_SEARCH_SETTINGS.queries.length;
    const outcome = await createActorSource(jobgetherBoard, runner).fetch(context({ maxUsd: 1 }));
    expect(calls).toHaveLength(total + 2);
    expect(calls.every((t) => t === 90)).toBe(true);
    const first = `"${DEFAULT_SEARCH_SETTINGS.queries[0]}"`;
    expect(outcome.failures).toEqual([`${first}: Apify run timed-out, kept 0 items`]);
    expect(outcome.costUsd).toBeCloseTo(0.005 * (total + 2));
    // A retry that fails still leaves the stalled run's cost and run id counted.
    let attempt = 0;
    const flaky: ApifyRunner = async () => {
      attempt += 1;
      if (attempt === 1) {
        return {
          items: [],
          costUsd: 0.005,
          status: "TIMED-OUT",
          partial: "Apify run timed-out, kept 0 items",
          runId: "stalled",
          datasetId: "ds-stalled",
        };
      }
      if (attempt === 2) throw new SourceError("Apify run r2 failed");
      return { items: [], costUsd: 0.005, status: "SUCCEEDED" };
    };
    const retried = await createActorSource(jobgetherBoard, flaky).fetch(context({ maxUsd: 1 }));
    expect(retried.costUsd).toBeCloseTo(0.005 * total);
    expect(retried.failures).toEqual([`${first}: Apify run r2 failed`]);
    expect(retried.providerRuns).toEqual([
      { label: `${first} (stalled)`, runId: "stalled", datasetId: "ds-stalled" },
    ]);
    // Boards without the option don't retry.
    calls.length = 0;
    stalls.set(0, 1);
    await createActorSource(diceBoard, runner).fetch(context({ maxUsd: 1 }));
    expect(calls).toHaveLength(total);
  });

  it("fits each search into the source's time and stops starting searches when it runs out", async () => {
    const start = Date.now();
    let elapsed = 0;
    vi.spyOn(Date, "now").mockImplementation(() => start + elapsed);
    const timeouts: number[] = [];
    const slow: ApifyRunner = async (_actor, _input, { timeoutSecs }) => {
      timeouts.push(timeoutSecs);
      elapsed += 9 * 60_000;
      return { items: [], costUsd: 0.01 };
    };
    const outcome = await createActorSource(hiringCafeBoard, slow).fetch(
      context({ maxUsd: 1, deadline: new Date(start + 10 * 60_000) }),
    );
    // 600 s left: the actor's 600 s timeout is cut to leave room for the runner's own wait. Two
    // searches start together (HiringCafe runs two at a time), then the time is up.
    expect(timeouts).toEqual([480, 480]);
    const total = DEFAULT_SEARCH_SETTINGS.queries.length;
    expect(outcome.failures).toEqual([
      `time limit reached, ${total - 2} of ${total} searches not run`,
    ]);
    expect(outcome.partial).toContain("time limit reached");
  });

  it("runs a board's searches a few at a time, sharing the cap, in search order", async () => {
    const board = { ...diceBoard, concurrency: 2 };
    const item = (id: string) => ({
      jobId: id,
      title: "AI Engineer",
      companyName: "Fernhollow AI",
      detailsPageUrl: `https://www.dice.com/job-detail/${id}`,
      isRemote: true,
      description_text: "Build agents.",
    });
    let running = 0;
    let most = 0;
    const shares: number[] = [];
    const runner: ApifyRunner = async (_actor, input, { maxUsd }) => {
      shares.push(maxUsd);
      running += 1;
      most = Math.max(most, running);
      const keyword = (input as { keyword: string }).keyword;
      // The first search of each pair finishes last.
      const index = DEFAULT_SEARCH_SETTINGS.queries.indexOf(keyword);
      await new Promise((resolve) => setTimeout(resolve, index % 2 === 0 ? 5 : 0));
      running -= 1;
      return { items: [item(`id-${index}`)], costUsd: 0.03 };
    };
    const total = DEFAULT_SEARCH_SETTINGS.queries.length;
    const outcome = await createActorSource(board, runner).fetch(context({ maxUsd: 1 }));
    expect(most).toBe(2);
    expect(outcome.postings.map((p) => p.externalId)).toEqual(
      DEFAULT_SEARCH_SETTINGS.queries.map((_, i) => `id-${i}`),
    );
    expect(outcome.costUsd).toBeCloseTo(0.03 * total);
    // Each of a pair gets half of what's left, so the two together stay within the cap.
    expect(shares.slice(0, 2)).toEqual([0.5, 0.5]);
    expect(shares[2]).toBeCloseTo((1 - 0.06) / 2);
    // A cap that covers two searches stops after the first pair.
    const capped = await createActorSource(board, runner).fetch(context({ maxUsd: 0.065 }));
    expect(capped.postings).toHaveLength(2);
    expect(capped.partial).toBe("spend cap reached after 0.06 USD");
  });

  it("says why it can't run without a key, and stops on an exhausted account", async () => {
    expect(createActorSource(builtInBoard, null).unavailable()).toBe("APIFY_API_KEY is not set");
    const refused: ApifyRunner = async () => {
      throw new Error("Apify refused the run (402: usage limit or plan exhausted)");
    };
    await expect(createActorSource(diceBoard, refused).fetch(context())).rejects.toThrow("402");
  });
});
