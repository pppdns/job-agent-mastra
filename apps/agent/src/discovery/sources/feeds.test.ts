import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findWorkspaceRoot } from "@copilot/db";
import { DEFAULT_SEARCH_SETTINGS, screenPosting } from "@copilot/shared";
import { describe, expect, it } from "vitest";
import { regionList } from "../text";
import { CooldownError, type FetchContext, SourceError } from "../types";
import { createFeedSource } from "./feed";
import { createNoDeskSource, parseNoDeskItem } from "./nodesk";
import { createRemoteOkSource, parseRemoteOkJob, remoteOkSalary } from "./remoteok";
import { parseRemotiveJob } from "./remotive";
import { decodeXml, parseRss, rssDate } from "./rss";
import { createWwrSource, parseWwrItem } from "./weworkremotely";

const text = (name: string) =>
  readFileSync(join(findWorkspaceRoot(), "fixtures/sources", name), "utf8").replace(
    /\{\{days-ago:(\d+)\}\}/g,
    (_, days: string) => new Date(Date.UTC(2026, 10, 10 - Number(days))).toUTCString(),
  );
const json = (name: string) => JSON.parse(text(name));

const context = (over: Partial<FetchContext> = {}): FetchContext => ({
  settings: DEFAULT_SEARCH_SETTINGS,
  since: new Date(0),
  backfill: false,
  knownIds: [],
  maxUsd: 0,
  ...over,
});

describe("RSS", () => {
  it("reads flat items: escaped HTML, CDATA, empty and self-closing tags", () => {
    const items = parseRss(
      `<rss><channel><title>Feed</title><item><title>A &amp; B</title><empty/><description>&lt;p&gt;Hi&lt;/p&gt;</description></item><item><description><![CDATA[<b>x</b>]]></description></item></channel></rss>`,
    );
    expect(items).toEqual([
      { title: "A & B", empty: "", description: "<p>Hi</p>" },
      { description: "<b>x</b>" },
    ]);
    expect(decodeXml("&#8217;&#x2014;&rsquo;")).toBe("’—&rsquo;");
    expect(rssDate("Mon, 09 Nov 2026 13:57:42 +0000")?.toISOString()).toBe(
      "2026-11-09T13:57:42.000Z",
    );
    expect(rssDate("soon")).toBeNull();
  });
});

describe("regionList", () => {
  it("turns board region text into regions, and unclear text into none", () => {
    expect(regionList("Anywhere in the World")).toEqual(["Worldwide"]);
    expect(regionList("USA Only")).toEqual(["USA"]);
    expect(regionList("Europe, UK")).toEqual(["Europe", "UK"]);
    expect(regionList("USA or Canada")).toEqual(["USA", "Canada"]);
    expect(regionList("Latin America Only")).toEqual(["Latin America"]);
    expect(regionList("")).toEqual([]);
    expect(regionList(null)).toEqual([]);
  });

  it("lets North America and US states through for someone who allows the US", () => {
    const posting = {
      title: "Engineer",
      company: "X",
      location: null,
      remote: true,
      regions: regionList("North America Only"),
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      postedAt: null,
    };
    expect(screenPosting(DEFAULT_SEARCH_SETTINGS, posting).pass).toBe(true);
    expect(
      screenPosting(DEFAULT_SEARCH_SETTINGS, { ...posting, regions: ["California"] }).pass,
    ).toBe(true);
    expect(
      screenPosting(DEFAULT_SEARCH_SETTINGS, { ...posting, regions: ["Latin America"] }).reasons,
    ).toEqual(["remote only from Latin America"]);
  });
});

describe("We Work Remotely", () => {
  const items = parseRss(text("weworkremotely.rss"));

  it("maps items: company from the title, region, type, full description", () => {
    expect(parseWwrItem(items[0])).toMatchObject({
      source: "weworkremotely",
      externalId: "brightwater-labs-senior-full-stack-engineer",
      url: "https://weworkremotely.com/remote-jobs/brightwater-labs-senior-full-stack-engineer",
      title: "Senior Full Stack Engineer",
      company: "Brightwater Labs",
      location: "Remote (Anywhere in the World)",
      remote: true,
      regions: ["Worldwide"],
      employmentType: "Full-Time",
      postedAt: new Date("2026-11-09T00:00:00Z"),
    });
    expect(parseWwrItem(items[0])?.description).toContain("field-survey software");
    expect(parseWwrItem(items[1])).toMatchObject({
      company: "Quillfeather Health",
      regions: ["Europe"],
      location: "Remote (Europe Only, Germany)",
    });
    expect(parseWwrItem({ title: "No company", link: "https://weworkremotely.com/x" })).toBeNull();
    expect(parseWwrItem({ title: "A: B", link: "https://evil.example/remote-jobs/a" })).toBeNull();
  });

  it("reads each configured category, skipping malformed slugs", async () => {
    const urls: string[] = [];
    const source = createWwrSource(async (url) => {
      urls.push(url.href);
      return text("weworkremotely.rss");
    }, 0);
    const settings = {
      ...DEFAULT_SEARCH_SETTINGS,
      sources: {
        ...DEFAULT_SEARCH_SETTINGS.sources,
        weworkremotely: { enabled: true, categories: ["remote-a-jobs", "../admin"] },
      },
    };
    const outcome = await source.fetch(context({ settings }));
    expect(urls).toEqual(["https://weworkremotely.com/categories/remote-a-jobs.rss"]);
    expect(outcome.postings).toHaveLength(3);
  });
});

describe("Remote OK", () => {
  const body = json("remoteok-api.json") as unknown[];

  it("maps jobs, keeps only plausible pay, drops the legal notice and bad items", async () => {
    expect(parseRemoteOkJob(body[1])).toMatchObject({
      source: "remoteok",
      externalId: "900001",
      url: "https://remoteok.com/remote-jobs/remote-ai-engineer-copperleaf-systems-900001",
      applyUrl: "https://jobs.copperleaf.example/ai-engineer",
      title: "AI Engineer",
      company: "Copperleaf Systems",
      regions: ["Worldwide"],
      salaryMax: 160_000,
      salaryText: "USD 120,000–160,000 per year",
      postedAt: new Date(1794211200 * 1000),
    });
    // Garbage pay is dropped, and an apply link back to Remote OK isn't an apply URL.
    expect(parseRemoteOkJob(body[2])).toMatchObject({ salaryMax: null, applyUrl: null });
    expect(remoteOkSalary(0, 0)).toBeNull();
    const outcome = await createRemoteOkSource(async () => body, 0).fetch(context());
    expect(outcome.postings.map((p) => p.externalId)).toEqual(["900001", "900002"]);
    expect(outcome.invalid).toBe(1);
  });
});

describe("Remotive", () => {
  it("maps jobs: UTC dates without a zone, region, pay as text", () => {
    const [first, second] = json("remotive-jobs.json").jobs as unknown[];
    expect(parseRemotiveJob(first)).toMatchObject({
      source: "remotive",
      externalId: "800001",
      company: "Lanternfish Analytics",
      regions: ["Europe"],
      employmentType: "full time",
      postedAt: new Date("2026-11-08T10:00:00Z"),
    });
    expect(parseRemotiveJob(second)).toMatchObject({ salaryText: "$40k - $50k", salaryMax: null });
  });
});

describe("NoDesk", () => {
  it("maps items: role and company from the title, entities decoded", async () => {
    const items = parseRss(text("nodesk.rss"));
    const posting = parseNoDeskItem(items[0]);
    expect(posting).toMatchObject({
      source: "nodesk",
      externalId: "brightwater-labs-site-reliability-engineer",
      title: "Site Reliability Engineer",
      company: "Brightwater Labs",
      remote: true,
    });
    expect(posting?.description).toContain("You’ll run the platform");
    const outcome = await createNoDeskSource(async () => text("nodesk.rss"), 0).fetch(context());
    expect(outcome.postings).toHaveLength(2);
  });
});

describe("feed sources", () => {
  const posting = parseRemotiveJob((json("remotive-jobs.json").jobs as unknown[])[0]);

  it("keeps items whatever their date and keeps going when one request fails", async () => {
    const source = createFeedSource({
      id: "remotive",
      pauseMs: 0,
      parse: () => posting,
      requests: () => [
        { label: "a", load: async () => [1] },
        {
          label: "b",
          load: async () => {
            throw new SourceError("remotive.com answered 404");
          },
        },
      ],
    });
    const outcome = await source.fetch(context());
    expect(outcome.postings).toHaveLength(1);
    expect(outcome.partial).toBe("some requests failed: b: remotive.com answered 404");
    // Remotive publishes a day late with the original date: an "old" item is still new to us.
    const later = await source.fetch(context({ since: new Date("2026-11-09T00:00:00Z") }));
    expect(later.postings).toHaveLength(1);
  });

  it("fails when every request fails or a cooldown stops it with nothing read", async () => {
    const failing = (error: Error) =>
      createFeedSource({
        id: "remotive",
        pauseMs: 0,
        parse: () => posting,
        requests: () => [
          {
            label: "a",
            load: async () => {
              throw error;
            },
          },
          { label: "b", load: async () => [1] },
        ],
      });
    await expect(failing(new CooldownError("slow down")).fetch(context())).rejects.toThrow(
      "stopped (a: slow down)",
    );
    await expect(failing(new SourceError("x")).fetch(context())).resolves.toMatchObject({
      partial: "some requests failed: a: x",
    });
  });
  it("starts no request after the source's time is up", async () => {
    const load = async () => [1];
    const source = createFeedSource({
      id: "remotive",
      pauseMs: 0,
      parse: () => posting,
      requests: () => [
        { label: "a", load },
        { label: "b", load },
      ],
    });
    await expect(source.fetch(context({ deadline: new Date(Date.now() - 1) }))).rejects.toThrow(
      "stopped (time limit reached, 2 of 2 searches not run)",
    );
  });
});
