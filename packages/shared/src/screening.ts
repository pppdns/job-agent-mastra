import { companyKey, normalizeText, type PostingInput, type SalaryPeriod } from "./posting";
import type { SearchSettings } from "./search-settings";

// The deterministic first filter. It only throws out clear misfits: job titles vary too much to
// require a match, so anything uncertain (no salary, remote status unknown, an unusual title)
// passes on to the LLM triage. Every rejection says why, so the screen can be tuned.

export type ScreenResult = { pass: boolean; reasons: string[] };

type Screened = Pick<
  PostingInput,
  | "title"
  | "company"
  | "location"
  | "remote"
  | "regions"
  | "salaryMax"
  | "salaryCurrency"
  | "salaryPeriod"
  | "postedAt"
>;

const DAY_MS = 86_400_000;

/** European countries, so "Europe" / "European Union" match a restriction like "Germany". */
const EUROPE = [
  "europe",
  "european union",
  "eu",
  "emea",
  "eea",
  "austria",
  "belgium",
  "bulgaria",
  "croatia",
  "cyprus",
  "czechia",
  "czech republic",
  "denmark",
  "estonia",
  "finland",
  "france",
  "germany",
  "greece",
  "hungary",
  "ireland",
  "italy",
  "latvia",
  "lithuania",
  "luxembourg",
  "malta",
  "netherlands",
  "poland",
  "portugal",
  "romania",
  "slovakia",
  "slovenia",
  "spain",
  "sweden",
  "norway",
  "iceland",
  "liechtenstein",
  "switzerland",
  "united kingdom",
  "uk",
];
const EUROPE_ALIASES = new Set(["europe", "european union", "eu", "emea", "eea"]);
const US_ALIASES = new Set(["united states", "usa", "us", "united states of america"]);
/** Regions in or around the US: a "North America only" or "California" role is open from the US. */
const US_REGIONS = [
  "north america",
  "americas",
  ..."alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada ohio oklahoma oregon pennsylvania tennessee texas utah vermont virginia washington wisconsin wyoming".split(
    " ",
  ),
  "new hampshire",
  "new jersey",
  "new mexico",
  "new york",
  "north carolina",
  "north dakota",
  "rhode island",
  "south carolina",
  "south dakota",
  "west virginia",
];
const WORLDWIDE = new Set(["worldwide", "anywhere", "anywhere in the world", "global", "remote"]);

const PER_YEAR: Record<SalaryPeriod, number> = {
  hour: 2_080,
  day: 260,
  week: 52,
  month: 12,
  year: 1,
};

/**
 * Rough value of one unit in EUR, for comparing pay against a floor in the other currency. Set by
 * hand (EUR/USD drifts slowly); cross-currency checks keep a margin so drift never decides.
 */
const EUR_PER_UNIT: Record<string, number> = { EUR: 1, USD: 0.87 };
/** Cross-currency pay is screened out only when clearly under the floor. */
export const CROSS_CURRENCY_MARGIN = 0.1;

/** Whole-word containment: every word of the phrase appears in the text. */
const hasPhrase = (text: string, phrase: string) => {
  const words = new Set(normalizeText(text).split(" "));
  const wanted = normalizeText(phrase).split(" ").filter(Boolean);
  return wanted.length > 0 && wanted.every((w) => words.has(w));
};

/** The places a configured region covers, normalized. */
function expand(region: string): string[] {
  const r = normalizeText(region);
  if (EUROPE_ALIASES.has(r)) return EUROPE;
  if (US_ALIASES.has(r)) return [...US_ALIASES, ...US_REGIONS];
  return [r];
}

const placeMatches = (place: string, allowed: string[]) => {
  const p = normalizeText(place);
  return allowed.some((a) => p === a || hasPhrase(p, a) || hasPhrase(a, p));
};

/**
 * Screens one posting. `maxAgeDays` overrides the settings' age limit (a backfill run looks
 * further back than the daily runs).
 */
export function screenPosting(
  settings: SearchSettings,
  posting: Screened,
  now: Date = new Date(),
  maxAgeDays: number = settings.maxAgeDays,
): ScreenResult {
  const reasons: string[] = [];

  const excluded = settings.titleExclude.find((phrase) => hasPhrase(posting.title, phrase));
  if (excluded) reasons.push(`title contains "${excluded}"`);

  const key = companyKey(posting.company);
  if (settings.blockedCompanies.some((c) => companyKey(c) === key)) {
    reasons.push(`company ${posting.company} is blocked`);
  }

  if (posting.postedAt) {
    const ageDays = Math.floor((now.getTime() - posting.postedAt.getTime()) / DAY_MS);
    if (ageDays > maxAgeDays) reasons.push(`posted ${ageDays} days ago`);
  }

  const floor = settings.minSalary;
  if (floor && posting.salaryMax !== null && posting.salaryCurrency) {
    const from = posting.salaryCurrency.toUpperCase();
    const to = floor.currency.toUpperCase();
    const rate = from === to ? 1 : (EUR_PER_UNIT[from] ?? 0) / (EUR_PER_UNIT[to] ?? 0);
    if (Number.isFinite(rate) && rate > 0) {
      const yearly = posting.salaryMax * PER_YEAR[posting.salaryPeriod ?? "year"];
      const margin = from === to ? 0 : CROSS_CURRENCY_MARGIN;
      if (yearly * rate < floor.amount * (1 - margin)) {
        const round = (n: number) => Math.round(n).toLocaleString("en-US");
        reasons.push(
          from === to
            ? `pay tops out at ${round(yearly)} ${to}/year`
            : `pay tops out at ${round(yearly)} ${from}/year (about ${round(yearly * rate)} ${to})`,
        );
      }
    }
  }

  const remoteAllowed = settings.remoteRegions.flatMap(expand);
  if (posting.remote === true && posting.regions.length > 0 && remoteAllowed.length > 0) {
    const open = posting.regions.some((r) => WORLDWIDE.has(normalizeText(r)));
    if (!open && !posting.regions.some((r) => placeMatches(r, remoteAllowed))) {
      reasons.push(`remote only from ${posting.regions.slice(0, 3).join(", ")}`);
    }
  }
  if (posting.remote === false && posting.location && settings.onsitePlaces.length > 0) {
    const onsite = settings.onsitePlaces.flatMap(expand);
    if (!placeMatches(posting.location, onsite)) {
      reasons.push(`not remote, in ${posting.location}`);
    }
  }

  return { pass: reasons.length === 0, reasons };
}
