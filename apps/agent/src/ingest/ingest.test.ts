import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDb, type Db, migrateDb, schema } from "@copilot/db";
import { beforeEach, describe, expect, it } from "vitest";
import type { PageResult, SearchHit, WebProviders } from "../web/providers";
import { canonicalWebUrl, type IngestDeps, ingestText, ingestUrl } from "./ingest";
import type { Resolver } from "./url-guard";

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, "../../../../fixtures/listings", name), "utf8");

const resolver: Resolver = async (host) =>
  host.startsWith("internal.") ? ["10.0.0.7"] : ["93.184.216.34"];

type Calls = { extract: string[]; scrape: string[]; search: string[] };

/** Fake providers: pages keyed by URL (any depth), optional per-depth overrides. */
function fakeWeb(
  pages: Record<string, PageResult | ((depth: string) => PageResult)>,
  hits: SearchHit[] = [],
  scrapePages: Record<string, PageResult> = {},
): { web: WebProviders; calls: Calls } {
  const calls: Calls = { extract: [], scrape: [], search: [] };
  const missing: PageResult = { ok: false, error: "404 page not found" };
  return {
    calls,
    web: {
      async extract(url, depth) {
        calls.extract.push(`${depth} ${url}`);
        const page = pages[url];
        return typeof page === "function" ? page(depth) : (page ?? missing);
      },
      scrape: async (url) => {
        calls.scrape.push(url);
        return scrapePages[url] ?? missing;
      },
      async search(query) {
        calls.search.push(query);
        return hits;
      },
    },
  };
}

const page = (name: string, finalUrl?: string): PageResult => ({
  ok: true,
  text: fixture(name),
  finalUrl,
});

const LINKEDIN = "https://www.linkedin.com/jobs/view/4479142839/";
const ATS_OTHER = "https://job-boards.greenhouse.io/northwindfreight/jobs/9";
const ATS_MATCH = "https://job-boards.greenhouse.io/northwindrobotics/jobs/1";

let db: Db;
const deps = (web: WebProviders | null): IngestDeps => ({ db, web, resolve: resolver });
const count = async () => ({
  jobs: (await db.select().from(schema.jobs)).length,
  sources: (await db.select().from(schema.sources)).length,
});

beforeEach(async () => {
  db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "ingest-")), "test.db")}`);
  await migrateDb(db);
});

describe("ingestUrl: LinkedIn", () => {
  it("saves a complete listing from the basic extract and dedupes repeat ingests", async () => {
    const { web, calls } = fakeWeb({ [LINKEDIN]: page("linkedin-complete.md") });
    const first = await ingestUrl(
      "https://hu.linkedin.com/jobs/view/platform-engineer-at-northwind-4479142839?trk=abc",
      { threadId: "thread-1" },
      deps(web),
    );
    expect(first).toMatchObject({
      status: "saved",
      newJob: true,
      complete: true,
      source: { kind: "linkedin", provider: "tavily", url: LINKEDIN },
      listing: { title: "Senior Platform Engineer", company: "Northwind Robotics" },
    });
    expect(calls.extract).toEqual([`basic ${LINKEDIN}`]);

    const again = await ingestUrl(LINKEDIN, { threadId: "thread-2", refresh: true }, deps(web));
    expect(again).toMatchObject({ status: "saved", newJob: false });
    if (first.status === "saved" && again.status === "saved") {
      expect(again.jobId).toBe(first.jobId);
      expect(again.source.id).toBe(first.source.id);
    }
    expect(await count()).toEqual({ jobs: 1, sources: 1 });
  });

  it("reports an already saved job without calling a provider", async () => {
    const { web, calls } = fakeWeb({ [LINKEDIN]: page("linkedin-complete.md") });
    const first = await ingestUrl(LINKEDIN, {}, deps(web));
    calls.extract.length = 0;
    const again = await ingestUrl(
      "https://www.linkedin.com/jobs/search/?currentJobId=4479142839&keywords=platform",
      { threadId: "thread-2" },
      deps(web),
    );
    expect(again).toMatchObject({
      status: "already_saved",
      job: {
        title: "Senior Platform Engineer",
        company: "Northwind Robotics",
        status: "new",
        archived: false,
        assessmentVersion: null,
      },
    });
    if (first.status === "saved" && again.status === "already_saved") {
      expect(again.jobId).toBe(first.jobId);
    }
    expect(calls.extract).toEqual([]);
    expect(await count()).toEqual({ jobs: 1, sources: 1 });
  });

  it("recognizes the employer posting found through LinkedIn, whatever its tracking parameters", async () => {
    const searchHit = `${ATS_MATCH}?gh_src=search`;
    const { web, calls } = fakeWeb(
      { [LINKEDIN]: page("linkedin-truncated.md"), [searchHit]: page("ats-complete.md") },
      [{ url: searchHit, title: "Senior Platform Engineer - Northwind Robotics" }],
    );
    expect(await ingestUrl(LINKEDIN, {}, deps(web))).toMatchObject({
      status: "saved",
      source: { kind: "ats", url: ATS_MATCH },
    });
    calls.extract.length = 0;
    for (const url of [ATS_MATCH, `${ATS_MATCH}?gh_src=newsletter`]) {
      expect(await ingestUrl(url, {}, deps(web))).toMatchObject({ status: "already_saved" });
    }
    expect(calls.extract).toEqual([]);
  });

  it("retries with advanced extraction when the basic result is incomplete", async () => {
    const { web, calls } = fakeWeb({
      [LINKEDIN]: (depth) =>
        depth === "basic" ? page("linkedin-truncated.md") : page("linkedin-complete.md"),
    });
    expect(await ingestUrl(LINKEDIN, {}, deps(web))).toMatchObject({ status: "saved" });
    expect(calls.extract).toEqual([`basic ${LINKEDIN}`, `advanced ${LINKEDIN}`]);
  });

  it("asks for a paste on a sign-in page without searching or saving anything", async () => {
    const { web, calls } = fakeWeb({ [LINKEDIN]: page("linkedin-login.md") });
    const result = await ingestUrl(LINKEDIN, {}, deps(web));
    expect(result).toMatchObject({ status: "needs_paste", partial: undefined });
    expect(calls.search).toEqual([]);
    expect(await count()).toEqual({ jobs: 0, sources: 0 });
  });

  it("treats an expired job's search page as missing", async () => {
    const { web } = fakeWeb({ [LINKEDIN]: page("linkedin-expired.md") });
    expect(await ingestUrl(LINKEDIN, {}, deps(web))).toMatchObject({ status: "needs_paste" });
    expect(await count()).toEqual({ jobs: 0, sources: 0 });
  });

  it("falls back to the employer ATS posting after an identity check", async () => {
    const { web, calls } = fakeWeb(
      {
        [LINKEDIN]: page("linkedin-truncated.md"),
        [ATS_OTHER]: page("ats-other-company.md"),
        [ATS_MATCH]: page("ats-complete.md"),
      },
      [
        { url: ATS_OTHER, title: "Senior Platform Engineer - Northwind Freight" },
        { url: ATS_MATCH, title: "Senior Platform Engineer - Northwind Robotics" },
      ],
    );
    const result = await ingestUrl(LINKEDIN, {}, deps(web));
    expect(result).toMatchObject({
      status: "saved",
      source: { kind: "ats", url: ATS_MATCH },
      listing: { title: "Senior Platform Engineer", company: "Northwind Robotics" },
    });
    expect(calls.search).toEqual(['"Senior Platform Engineer" "Northwind Robotics"']);
    if (result.status === "saved") {
      expect(result.attempts).toContainEqual({
        step: "ats:candidate",
        url: ATS_OTHER,
        outcome: "different job or company",
      });
    }
  });

  it("asks for a paste with the partial identity when no ATS posting matches", async () => {
    const { web } = fakeWeb(
      { [LINKEDIN]: page("linkedin-truncated.md"), [ATS_OTHER]: page("ats-other-company.md") },
      [{ url: ATS_OTHER, title: "Senior Platform Engineer" }],
    );
    expect(await ingestUrl(LINKEDIN, {}, deps(web))).toMatchObject({
      status: "needs_paste",
      partial: { title: "Senior Platform Engineer", company: "Northwind Robotics" },
    });
    expect(await count()).toEqual({ jobs: 0, sources: 0 });
  });

  it("rejects LinkedIn URLs that aren't job pages without calling a provider", async () => {
    const { web, calls } = fakeWeb({});
    expect(await ingestUrl("https://www.linkedin.com/feed/", {}, deps(web))).toMatchObject({
      status: "needs_paste",
    });
    expect(calls.extract).toEqual([]);
  });
});

describe("ingestUrl: guard and other pages", () => {
  it.each(["http://localhost:3000/", "https://internal.example.com/job", "file:///etc/passwd"])(
    "blocks %s before any provider call",
    async (url) => {
      const { web, calls } = fakeWeb({});
      expect(await ingestUrl(url, {}, deps(web))).toMatchObject({ status: "blocked" });
      expect(calls.extract).toEqual([]);
    },
  );

  it("discards content when the provider was redirected to a private address", async () => {
    const { web } = fakeWeb({
      "https://jobs.example.com/1": page("ats-complete.md", "https://internal.example.com/1"),
    });
    expect(await ingestUrl("https://jobs.example.com/1", {}, deps(web))).toMatchObject({
      status: "needs_paste",
    });
    expect(await count()).toEqual({ jobs: 0, sources: 0 });
  });

  it("uses Firecrawl when Tavily can't read a non-LinkedIn page", async () => {
    const url = "https://careers.example.com/platform-engineer";
    const { web } = fakeWeb({}, [], { [url]: page("ats-complete.md") });
    expect(await ingestUrl(`${url}?utm_source=x#apply`, {}, deps(web))).toMatchObject({
      status: "saved",
      source: { kind: "web", provider: "firecrawl", url },
    });
  });

  it("recognizes a saved page under different tracking parameters", async () => {
    const url = "https://careers.example.com/platform-engineer";
    const { web, calls } = fakeWeb({ [url]: page("ats-complete.md") });
    await ingestUrl(`${url}?utm_source=x`, {}, deps(web));
    calls.extract.length = 0;
    expect(await ingestUrl(`${url}#apply`, {}, deps(web))).toMatchObject({
      status: "already_saved",
    });
    expect(calls.extract).toEqual([]);
  });

  it("asks for a paste when no web provider is configured", async () => {
    expect(await ingestUrl(LINKEDIN, {}, deps(null))).toMatchObject({ status: "needs_paste" });
  });
});

describe("ingestText", () => {
  it("saves pasted text and dedupes it with the LinkedIn job by company and title", async () => {
    const { web } = fakeWeb({ [LINKEDIN]: page("linkedin-complete.md") });
    const linkedin = await ingestUrl(LINKEDIN, {}, deps(web));
    const pasted = await ingestText(
      fixture("ats-complete.md"),
      { company: "Northwind Robotics", title: "Senior Platform Engineer" },
      { threadId: "t" },
      { db },
    );
    expect(pasted).toMatchObject({
      status: "saved",
      newJob: false,
      complete: true,
      source: { kind: "pasted", provider: "user", url: null },
    });
    if (linkedin.status === "saved" && pasted.status === "saved") {
      expect(pasted.jobId).toBe(linkedin.jobId);
    }
    expect(await count()).toEqual({ jobs: 1, sources: 2 });
  });

  it("flags short pasted text as a possible snippet", async () => {
    const result = await ingestText("Senior engineer at Acme, remote.", {}, {}, { db });
    expect(result).toMatchObject({ status: "saved", complete: false });
  });
});

describe("canonicalWebUrl", () => {
  it("drops fragments and tracking parameters but keeps real ones", () => {
    expect(
      canonicalWebUrl(new URL("https://jobs.example.com/j?id=7&utm_medium=x&gh_src=y#top")),
    ).toBe("https://jobs.example.com/j?id=7");
  });
});
