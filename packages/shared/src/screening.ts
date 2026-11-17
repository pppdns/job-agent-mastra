import { companyKey, normalizeText, type PostingInput } from "./posting";
import type { Preferences } from "./preferences";
import { matchCommute, matchPlaces } from "./remote-scope";
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

/** Whole-word containment: every word of the phrase appears in the text. */
const hasPhrase = (text: string, phrase: string) => {
  const words = new Set(normalizeText(text).split(" "));
  const wanted = normalizeText(phrase).split(" ").filter(Boolean);
  return wanted.length > 0 && wanted.every((w) => words.has(w));
};

const placeMatches = (place: string, wanted: string) => {
  const p = normalizeText(place);
  const w = normalizeText(wanted);
  return p === w || hasPhrase(p, w) || hasPhrase(w, p);
};

/** What the screen reads: the search settings' filters plus the structured preferences. */
export type ScreenCriteria = Pick<
  SearchSettings,
  "titleExclude" | "blockedCompanies" | "maxAgeDays"
> & {
  /** Without preferences (or without a home), places are not screened. */
  preferences?: Preferences;
};

/** Whether hybrid or on-site work at `location` is acceptable at all (any level but `no`). */
function officeAllowed(location: string, p: Preferences): boolean {
  const { workMode: wm, home } = p;
  const listed = [...wm.hybrid, ...wm.onsite];
  const at = (place: string) =>
    placeMatches(location, place) ||
    (home !== null &&
      normalizeText(place) === normalizeText(home.city) &&
      matchCommute(location, home) === "covers");
  if (listed.some((i) => i.level !== "no" && at(i.place))) return true;
  if (listed.some((i) => i.level === "no" && at(i.place))) return false;
  return wm.hybridElsewhere !== "no" || wm.onsiteElsewhere !== "no";
}

/**
 * Screens one posting. `maxAgeDays` overrides the settings' age limit (a backfill run looks
 * further back than the daily runs).
 */
export function screenPosting(
  settings: ScreenCriteria,
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

  const prefs = settings.preferences;
  const home = prefs?.home;
  if (home && posting.remote === true && posting.regions.length > 0) {
    // Board region tags say where the hire must live: screened out only when every known tag
    // is somewhere else ("United States"); unknown tags pass on to triage.
    if (matchPlaces(posting.regions, home) === "excludes") {
      reasons.push(`remote only from ${posting.regions.slice(0, 3).join(", ")}`);
    }
  }
  if (
    prefs &&
    posting.remote === false &&
    posting.location &&
    !officeAllowed(posting.location, prefs)
  ) {
    reasons.push(`not remote, in ${posting.location}`);
  }

  return { pass: reasons.length === 0, reasons };
}
