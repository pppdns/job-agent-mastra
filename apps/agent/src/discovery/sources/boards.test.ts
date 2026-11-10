import { DEFAULT_SEARCH_SETTINGS, screenPosting } from "@copilot/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FetchContext } from "../types";
import { createActorSource, windowFor } from "./actor-source";
import type { ApifyRunner } from "./apify";
import {
  builtInBoard,
  careerSitesBoard,
  diceBoard,
  hiringCafeBoard,
  jobgetherBoard,
  parseBuiltInItem,
  parseCareerSiteItem,
  parseDiceItem,
  parseHiringCafeItem,
  parseNomadRow,
  parseWellfoundItem,
  wellfoundBoard,
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
    const [yc] = ycombinatorBoard.searches(context());
    expect(yc?.input).toMatchObject({
      schemaVersion: "nomad-agent-simple-inventory-search-v2",
      queries: DEFAULT_SEARCH_SETTINGS.queries,
      maxItems: 200,
      dedupe: { enabled: false },
    });
    expect(jobgetherBoard.searches(context())).toHaveLength(1);
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

describe("YC Work at a Startup and Jobgether", () => {
  const row = {
    schemaVersion: "nomad-agent-job-row-v5",
    id: "121173",
    url: "https://www.workatastartup.com/jobs/121173",
    title: "Design Engineer",
    company: "Entangl",
    locations: ["San Francisco, CA, US / London, England, GB"],
    applicantLocations: ["US", "GB"],
    postedAt: "2026-11-09T16:00:00Z",
    workType: "remote",
    salary: "$120K - $180K",
    employmentTypes: ["Full-time"],
    descriptionHtml: "<p>Build the <a href='https://x.example'>editor</a>.</p>",
  };

  it("maps rows: country codes as names, yearly pay, date-only dates", () => {
    expect(parseNomadRow("ycombinator")(row)).toMatchObject({
      source: "ycombinator",
      externalId: "121173",
      remote: true,
      regions: ["United States", "United Kingdom"],
      salaryMin: 120_000,
      salaryMax: 180_000,
      salaryCurrency: "USD",
      salaryPeriod: "year",
      employmentType: "Full-time",
      description: "Build the editor.",
    });
    expect(
      parseNomadRow("jobgether")({ ...row, postedAt: "2026-11-10", salary: null }),
    ).toMatchObject({ postedAt: new Date("2026-11-10T00:00:00Z"), salaryMax: null });
    expect(parseNomadRow("ycombinator")({ ...row, url: "javascript:x" })).toBeNull();
    // An "EMEA" list of ~130 country codes restricts nothing useful.
    const emea = Array.from({ length: 130 }, (_, i) => `C${i}`);
    expect(parseNomadRow("jobgether")({ ...row, applicantLocations: emea })?.regions).toEqual([]);
  });

  it("screens an on-site role elsewhere out, a remote one from the UK through", () => {
    const remote = parseNomadRow("ycombinator")(row);
    const onsite = parseNomadRow("ycombinator")({ ...row, workType: "onsite" });
    expect(remote && screenPosting(DEFAULT_SEARCH_SETTINGS, remote, now).pass).toBe(true);
    expect(onsite && screenPosting(DEFAULT_SEARCH_SETTINGS, onsite, now).reasons).toEqual([
      "not remote, in San Francisco, CA, US / London, England, GB",
    ]);
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
  const row = (id: string, postedAt: string) => ({
    id,
    url: `https://www.workatastartup.com/jobs/${id}`,
    title: "AI Engineer",
    company: "Fernhollow AI",
    workType: "remote",
    postedAt,
  });

  it("runs each search within the spend cap and keeps every valid item", async () => {
    const calls: unknown[] = [];
    const runner: ApifyRunner = async (actorId, input, { maxUsd }) => {
      calls.push({ actorId, input, maxUsd });
      return {
        items: [row("1", "2026-11-10T00:00:00Z"), row("2", "2026-11-01T00:00:00Z"), {}],
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
    expect(yc.providerRuns).toEqual([{ label: "all phrases", runId: "run-4", datasetId: "ds-4" }]);
    expect(yc.raw).toEqual({
      invalid: [{}],
      sample: [expect.objectContaining({ id: "1" }), expect.objectContaining({ id: "2" })],
    });
  });

  afterEach(() => vi.restoreAllMocks());

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
    // 600 s left: the actor's 600 s timeout is cut to leave room for the runner's own wait.
    expect(timeouts).toEqual([480]);
    const total = DEFAULT_SEARCH_SETTINGS.queries.length;
    expect(outcome.failures).toEqual([
      `time limit reached, ${total - 1} of ${total} searches not run`,
    ]);
    expect(outcome.partial).toContain("time limit reached");
  });

  it("says why it can't run without a key, and stops on an exhausted account", async () => {
    expect(createActorSource(builtInBoard, null).unavailable()).toBe("APIFY_API_KEY is not set");
    const refused: ApifyRunner = async () => {
      throw new Error("Apify refused the run (402: usage limit or plan exhausted)");
    };
    await expect(createActorSource(diceBoard, refused).fetch(context())).rejects.toThrow("402");
  });
});
