import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findWorkspaceRoot } from "@copilot/db";
import type { DiscoverySource } from "@copilot/shared";
import { env } from "../../env";
import type { JobSource } from "../types";
import { type ApifyRunner, createApifyRunner } from "./apify";
import { createHimalayasSource } from "./himalayas";
import { type HttpJson, httpJson } from "./http";
import { createLinkedInSource } from "./linkedin";

const DAY_MS = 86_400_000;

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(findWorkspaceRoot(), "fixtures/sources", name), "utf8"));

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

/** Offline Himalayas: the fixture page for the first page of every query, then nothing. */
const fixtureHttp: HttpJson = async (url) => {
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

/** Offline Apify: the fixture dataset for every LinkedIn search, at the fixture price. */
const fixtureRunner: ApifyRunner = async (_actor, _input, { prices }) => {
  const items = shiftDates(
    fixture("linkedin-items.json") as Raw[],
    (i) => (typeof i.postedDate === "string" ? Date.parse(i.postedDate) : null),
    (i, ms) => {
      i.postedDate = new Date(ms).toISOString();
    },
  );
  return { items, costUsd: (prices.result ?? 0) * items.length };
};

/** The discovery sources, live or (WEB_MODE=fixture) offline. */
export function discoverySources(): Record<DiscoverySource, JobSource> {
  if (env.WEB_MODE === "fixture") {
    return {
      himalayas: createHimalayasSource(fixtureHttp),
      linkedin: createLinkedInSource(fixtureRunner),
    };
  }
  return {
    himalayas: createHimalayasSource(httpJson, env.HIMALAYAS_API_KEY),
    linkedin: createLinkedInSource(
      env.APIFY_API_KEY ? createApifyRunner(httpJson, env.APIFY_API_KEY) : null,
    ),
  };
}
