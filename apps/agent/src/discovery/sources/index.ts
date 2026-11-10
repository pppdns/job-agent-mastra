import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findWorkspaceRoot } from "@copilot/db";
import type { DiscoverySource } from "@copilot/shared";
import { env } from "../../env";
import type { JobSource } from "../types";
import { createActorSource } from "./actor-source";
import { type ApifyRunner, createApifyRunner, RESULT_EVENT } from "./apify";
import { ACTOR_BOARDS } from "./boards";
import { createHimalayasSource } from "./himalayas";
import { type HttpJson, type HttpText, httpJson, httpText } from "./http";
import { createLinkedInSource, LINKEDIN_ACTOR } from "./linkedin";
import { createNoDeskSource } from "./nodesk";
import { createRemoteOkSource } from "./remoteok";
import { createRemotiveSource } from "./remotive";
import { createWwrSource } from "./weworkremotely";

const DAY_MS = 86_400_000;

const fixtureText = (name: string) =>
  readFileSync(join(findWorkspaceRoot(), "fixtures/sources", name), "utf8");
const fixture = (name: string): unknown => JSON.parse(fixtureText(name));

/** Moves fixture dates so the newest is a day old (fixtures stay "recent" forever). */
function shiftDates<T>(items: T[], get: (t: T) => number | null, set: (t: T, ms: number) => void) {
  const times = items.map(get).filter((t): t is number => t !== null);
  if (times.length === 0) return items;
  const delta = Date.now() - DAY_MS - Math.max(...times);
  for (const item of items) {
    const t = get(item);
    if (t !== null) set(item, t + delta);
  }
  return items;
}

type Raw = Record<string, unknown>;

/** Offline feeds: the fixture for each board's API (Himalayas: first page only). */
const fixtureHttp: HttpJson = async (url) => {
  if (url.hostname === "remoteok.com") {
    const body = fixture("remoteok-api.json") as Raw[];
    const jobs = shiftDates(
      body.filter((j) => "id" in j),
      (j) => (j.epoch ? Number(j.epoch) * 1000 : null),
      (j, ms) => {
        j.epoch = String(Math.floor(ms / 1000));
      },
    );
    return [body[0], ...jobs];
  }
  if (url.hostname === "remotive.com") {
    const body = fixture("remotive-jobs.json") as { jobs: Raw[] };
    shiftDates(
      body.jobs,
      (j) => (typeof j.publication_date === "string" ? Date.parse(`${j.publication_date}Z`) : null),
      (j, ms) => {
        j.publication_date = new Date(ms).toISOString().slice(0, 19);
      },
    );
    return body;
  }
  if (url.searchParams.get("page") !== "1") return { jobs: [] };
  const body = fixture("himalayas-search.json") as { jobs: Raw[] };
  shiftDates(
    body.jobs,
    (j) => (typeof j.pubDate === "number" ? j.pubDate * 1000 : null),
    (j, ms) => {
      j.pubDate = Math.floor(ms / 1000);
    },
  );
  return body;
};

/**
 * Offline RSS: the board's fixture feed for its first category, empty for the rest. Fixture
 * dates are written as `{{days-ago:N}}`.
 */
const fixtureRss: HttpText = async (url) => {
  const name = url.hostname === "nodesk.co" ? "nodesk.rss" : "weworkremotely.rss";
  const first = url.pathname.includes("engineering") || url.pathname.includes("full-stack");
  const feed = fixtureText(name);
  const text = first ? feed : feed.replace(/<item>[\s\S]*<\/item>/, "");
  return text.replace(/\{\{days-ago:(\d+)\}\}/g, (_, days: string) =>
    new Date(Date.now() - Number(days) * DAY_MS).toUTCString(),
  );
};

/** Offline Apify: a fixture dataset per actor (LinkedIn and YC; the other boards find nothing). */
const ACTOR_FIXTURES: Record<string, { file: string; date: string }> = {
  [LINKEDIN_ACTOR]: { file: "linkedin-items.json", date: "postedDate" },
  "nomad-agent/ycombinator-was-scraper": { file: "ycombinator-items.json", date: "postedAt" },
};

const fixtureRunner: ApifyRunner = async (actorId, _input, { prices }) => {
  const known = ACTOR_FIXTURES[actorId];
  if (!known) return { items: [], costUsd: 0 };
  const items = shiftDates(
    fixture(known.file) as Raw[],
    (i) => (typeof i[known.date] === "string" ? Date.parse(i[known.date] as string) : null),
    (i, ms) => {
      i[known.date] = new Date(ms).toISOString();
    },
  );
  return { items, costUsd: (prices[RESULT_EVENT] ?? 0) * items.length };
};

const actorSources = (runner: ApifyRunner | null) =>
  Object.fromEntries(ACTOR_BOARDS.map((board) => [board.id, createActorSource(board, runner)]));

/** The discovery sources, live or (WEB_MODE=fixture) offline. */
export function discoverySources(): Record<DiscoverySource, JobSource> {
  if (env.WEB_MODE === "fixture") {
    return {
      himalayas: createHimalayasSource(fixtureHttp, undefined, 0),
      weworkremotely: createWwrSource(fixtureRss, 0),
      remoteok: createRemoteOkSource(fixtureHttp, 0),
      remotive: createRemotiveSource(fixtureHttp, 0),
      nodesk: createNoDeskSource(fixtureRss, 0),
      linkedin: createLinkedInSource(fixtureRunner),
      ...actorSources(fixtureRunner),
    } as Record<DiscoverySource, JobSource>;
  }
  const runner = env.APIFY_API_KEY ? createApifyRunner(httpJson, env.APIFY_API_KEY) : null;
  return {
    himalayas: createHimalayasSource(httpJson, env.HIMALAYAS_API_KEY),
    weworkremotely: createWwrSource(httpText),
    remoteok: createRemoteOkSource(httpJson),
    remotive: createRemotiveSource(httpJson),
    nodesk: createNoDeskSource(httpText),
    linkedin: createLinkedInSource(runner),
    ...actorSources(runner),
  } as Record<DiscoverySource, JobSource>;
}
