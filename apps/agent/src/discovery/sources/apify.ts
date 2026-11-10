import { SourceError } from "../types";
import type { HttpJson } from "./http";

// A minimal Apify REST runner for pay-per-event Store actors: start a run with a spend cap, wait
// for it within our own deadline, read its dataset. Proxies are part of the actors' event price.
// https://docs.apify.com/api/v2

const API = "https://api.apify.com/v2";
const WAIT_SECS = 60;
const PAGE = 1_000;
const MAX_ITEMS = 5_000;
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]);

/** Event prices of an actor (USD per Apify event name), used when a run doesn't report its cost. */
export type ActorPrices = Record<string, number>;

export type ActorRunResult = {
  items: unknown[];
  costUsd: number;
  /** Set when the run stopped early (timed out or was aborted) but left some items. */
  partial?: string;
};

type Run = {
  id: string;
  status: string;
  defaultDatasetId: string;
  /** What Apify charged for the run (pay-per-event actors: the events), USD. */
  usageTotalUsd?: number;
  chargedEventCounts?: Record<string, number>;
  pricingInfo?: {
    pricingPerEvent?: { actorChargeEvents?: Record<string, { eventPriceUsd?: number }> };
  };
};

/** Apify's event names for one dataset result and the start fee of pay-per-event actors. */
export const RESULT_EVENT = "apify-default-dataset-item";
export const START_EVENT = "apify-actor-start";

export type ApifyRunner = (
  actorId: string,
  input: unknown,
  options: { maxUsd: number; timeoutSecs: number; prices: ActorPrices; signal?: AbortSignal },
) => Promise<ActorRunResult>;

/**
 * What the run cost: Apify's own `usageTotalUsd` when it reports one; otherwise the charged
 * event counts times the run's event prices (falling back to our price table); otherwise items
 * plus one start at our prices.
 */
export function runCost(
  run: Pick<Run, "usageTotalUsd" | "chargedEventCounts" | "pricingInfo">,
  prices: ActorPrices,
  items: number,
) {
  if (typeof run.usageTotalUsd === "number" && run.usageTotalUsd > 0) return run.usageTotalUsd;
  const runPrices = run.pricingInfo?.pricingPerEvent?.actorChargeEvents ?? {};
  const counts = run.chargedEventCounts ?? { [RESULT_EVENT]: items, [START_EVENT]: 1 };
  return Object.entries(counts).reduce(
    (sum, [event, n]) => sum + (runPrices[event]?.eventPriceUsd ?? prices[event] ?? 0) * n,
    0,
  );
}

export function createApifyRunner(http: HttpJson, token: string): ApifyRunner {
  const auth = { authorization: `Bearer ${token}` };
  const call = async (path: string, init: Parameters<HttpJson>[1] = {}) => {
    try {
      return await http(new URL(`${API}${path}`), { ...init, headers: auth });
    } catch (error) {
      if (error instanceof SourceError && / 402$/.test(error.message)) {
        throw new SourceError("Apify refused the run (402: usage limit or plan exhausted)");
      }
      if (error instanceof SourceError && / 401$/.test(error.message)) {
        throw new SourceError("Apify rejected the API key (401)");
      }
      throw error;
    }
  };
  const runOf = (body: unknown): Run => {
    const run = (body as { data?: Run })?.data;
    if (!run?.id || !run.status) throw new SourceError("Apify returned an unexpected run");
    return run;
  };

  return async (actorId, input, { maxUsd, timeoutSecs, prices, signal }) => {
    const actor = actorId.replace("/", "~");
    const params = new URLSearchParams({
      maxTotalChargeUsd: maxUsd.toFixed(2),
      timeout: String(timeoutSecs),
      memory: "1024",
      waitForFinish: String(WAIT_SECS),
    });
    let run = runOf(
      await call(`/acts/${actor}/runs?${params}`, {
        method: "POST",
        body: input,
        signal,
        timeoutMs: 90_000,
      }),
    );
    const deadline = Date.now() + (timeoutSecs + 60) * 1_000;
    while (!TERMINAL.has(run.status)) {
      if (Date.now() > deadline) {
        await call(`/actor-runs/${run.id}/abort`, { method: "POST", signal }).catch(
          () => undefined,
        );
        throw new SourceError(`Apify run did not finish in ${timeoutSecs}s`);
      }
      run = runOf(
        await call(`/actor-runs/${run.id}?waitForFinish=${WAIT_SECS}`, {
          signal,
          timeoutMs: 90_000,
        }),
      );
    }
    if (run.status === "FAILED") throw new SourceError(`Apify run ${run.id} failed`);

    const items: unknown[] = [];
    for (let offset = 0; offset < MAX_ITEMS; offset += PAGE) {
      const page = await call(
        `/datasets/${run.defaultDatasetId}/items?clean=true&format=json&limit=${PAGE}&offset=${offset}`,
        { signal },
      );
      if (!Array.isArray(page)) throw new SourceError("Apify returned an unexpected dataset page");
      items.push(...page);
      if (page.length < PAGE) break;
    }
    return {
      items,
      costUsd: runCost(run, prices, items.length),
      partial:
        run.status === "SUCCEEDED"
          ? undefined
          : `Apify run ${run.status.toLowerCase()}, kept ${items.length} items`,
    };
  };
}
