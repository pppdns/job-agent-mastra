import {
  type Eligibility,
  type FitChip,
  formatPay,
  JOB_LEVEL_LABELS,
  type JobLevel,
  type ListingFacts,
  matchPlace,
  type PreferenceLevel,
  type Preferences,
  parsePayText,
  ROLE_FOCUS_LABELS,
  TRAVEL_LIMIT_LABELS,
  TRAVEL_LIMITS,
  toAnnual,
} from "@copilot/shared";

// The at-a-glance chips of a job: pure, from its verified listing facts, the eligibility code
// decided, and the person's structured preferences. Colors carry meaning only: a preference
// level, or how pay and place compare with the preferences. Dashed = not confirmed by the
// listing ("?"). Every chip keeps the listing's words for its tooltip.

export type ChipTone = "success" | "info" | "warning" | "destructive" | "muted";

export type Chip = {
  key: string;
  label: string;
  tone: ChipTone;
  /** Not confirmed by the listing: shown dashed with a "?". */
  dashed?: boolean;
  /** An extreme worth attention (high pay, staff+ levels): shown filled. */
  filled?: boolean;
  /** One line for the tooltip and screen readers. */
  hint: string;
  /** The listing's words this chip rests on. */
  quote?: string | null;
};

export type JobChipInput = {
  facts: ListingFacts | null;
  eligibility: Eligibility | null;
  eligibilityQuote: string | null;
  /** Pay as the assessment states it (a fallback when the facts have none). */
  salaryText?: string | null;
  hardConflicts?: number;
  /** Labelled assessment points (hard conflicts, quoted strengths and weaknesses). */
  fitChips?: FitChip[];
};

export const LEVEL_TONE: Record<PreferenceLevel, ChipTone> = {
  preferred: "success",
  ok: "muted",
  disliked: "warning",
  no: "destructive",
};

/** Levels worth attention whatever the preference. */
const EXTREME_LEVELS: readonly JobLevel[] = ["staff", "principal", "lead", "head", "founding"];

/** The pay chip's label when nothing is stated (shown without the money icon). */
export const NO_SALARY = "No salary";

/** Most chips on the second line; the rest collapse into "+N". */
export const MAX_SECONDARY = 5;

const short = (s: string, max = 22) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The place a chip names: one that includes home, else the first stated. */
function placeLabel(facts: ListingFacts, prefs: Preferences, mode: "remote" | "office") {
  if (mode === "remote" && facts.remoteScope === "worldwide") return "anywhere";
  const bases =
    mode === "remote"
      ? ["residence", "hiring_entity", "listed"]
      : ["office", "listed", "residence"];
  const places = [
    ...(mode === "remote" ? facts.headerPlaces : []),
    ...facts.places.filter((p) => bases.includes(p.basis)).map((p) => p.place),
  ];
  const home = prefs.home;
  const parts = (p: string) =>
    p
      .split(/[,;/|()]|\s+(?:and|or)\s+/i)
      .map((x) => x.trim())
      .filter(Boolean);
  // From a list ("Greece, Norway, …, Hungary") name the part that includes home.
  const covering = home
    ? places.flatMap(parts).find((p) => matchPlace(p, home) === "covers" && p.length <= 30)
    : undefined;
  const place = covering ?? (places[0] ? parts(places[0])[0] : undefined);
  return place ? short(place, 18) : null;
}

/** The preference level for office work at a place (named places first, then elsewhere). */
function officeLevel(facts: ListingFacts, prefs: Preferences, mode: "hybrid" | "onsite") {
  const wm = prefs.workMode;
  const items = mode === "hybrid" ? wm.hybrid : wm.onsite;
  const places = facts.places.filter((p) => p.basis === "office" || p.basis === "listed");
  const hit = items.find((i) =>
    places.some((p) => p.place.toLowerCase().includes(i.place.toLowerCase())),
  );
  return hit?.level ?? (mode === "hybrid" ? wm.hybridElsewhere : wm.onsiteElsewhere);
}

const ELIGIBILITY_HINT: Record<Eligibility, string> = {
  open: "The listing says you may work on it from where you live.",
  likely_open: "The listing hints you may work on it from where you live, but doesn't say so.",
  unclear: "The listing doesn't say whether you may work on it from where you live.",
  likely_closed: "The listing hints this job isn't open from where you live.",
  closed: "The listing says this job isn't open from where you live.",
};

function workModeChip(job: JobChipInput, prefs: Preferences): Chip {
  const f = job.facts;
  if (!f) {
    return {
      key: "mode",
      label: "Location ?",
      tone: "muted",
      dashed: true,
      hint: "The listing's facts haven't been read yet.",
    };
  }
  const days = f.officeDays ? ` · ${f.officeDays.perWeek}d/wk` : "";
  const mode = f.workMode;
  const where =
    mode === "remote"
      ? placeLabel(f, prefs, "remote")
      : mode === "unclear"
        ? null
        : placeLabel(f, prefs, "office");
  const base =
    mode === "remote"
      ? "Remote"
      : mode === "hybrid"
        ? "Hybrid"
        : mode === "onsite"
          ? "On-site"
          : "Work mode";
  const named = `${base}${where ? ` · ${where}` : ""}${mode === "hybrid" ? days : ""}`;
  const quote = job.eligibilityQuote ?? f.workModeQuote;
  const e = job.eligibility;
  if (e === "closed" || e === "likely_closed") {
    return {
      key: "mode",
      label: `${named}${e === "likely_closed" ? " ?" : ""} · not for you`,
      tone: "destructive",
      dashed: e === "likely_closed",
      hint: ELIGIBILITY_HINT[e],
      quote,
    };
  }
  const level: PreferenceLevel | null =
    mode === "remote"
      ? prefs.workMode.remote
      : mode === "hybrid" || mode === "onsite"
        ? officeLevel(f, prefs, mode)
        : null;
  if (e === "unclear" || mode === "unclear") {
    return {
      key: "mode",
      label: `${named} ?`,
      tone: "warning",
      dashed: true,
      hint: e ? ELIGIBILITY_HINT[e] : "The listing doesn't state the work mode clearly.",
      quote,
    };
  }
  const tone = level ? LEVEL_TONE[level] : "muted";
  return {
    key: "mode",
    label: e === "likely_open" ? `${named} ?` : named,
    tone: e === null ? "muted" : tone,
    dashed: e === "likely_open",
    hint: e ? ELIGIBILITY_HINT[e] : "Set where you live on your profile to check it.",
    quote,
  };
}

function salaryChip(job: JobChipInput, prefs: Preferences): Chip {
  const facts = job.facts?.salary;
  // Without verified facts, the figures in the assessment's pay text.
  const parsed = !facts && job.salaryText ? parsePayText(job.salaryText) : null;
  const pay = facts ?? parsed;
  if (!pay) {
    if (job.salaryText) {
      return {
        key: "pay",
        label: short(job.salaryText, 26),
        tone: "muted",
        dashed: true,
        hint: `Pay as the assessment states it: ${job.salaryText}`,
      };
    }
    return {
      key: "pay",
      label: NO_SALARY,
      tone: "muted",
      dashed: true,
      hint: "The listing states no pay.",
    };
  }
  const { floor, high, currency } = prefs.salary;
  const top = pay.max ?? pay.min;
  const annual = top === null ? null : toAnnual(top, pay, currency);
  const approx =
    annual === null
      ? ""
      : ` About ${Math.round(annual).toLocaleString("en-US")} ${currency} a year at most.`;
  const below = annual !== null && floor !== null && annual < floor;
  const great = annual !== null && high !== null && annual >= high;
  const verdict = below
    ? "Under your floor."
    : great
      ? "At or above your great mark."
      : "Stated pay.";
  const guessed =
    parsed && !parsed.periodStated
      ? ` Period not stated; read as ${parsed.period === "month" ? "monthly" : "yearly"}.`
      : "";
  return {
    key: "pay",
    label: formatPay(pay),
    tone: below ? "destructive" : great ? "success" : "muted",
    filled: great,
    dashed: !!parsed && !parsed.periodStated,
    hint: parsed
      ? `Pay as the assessment states it: ${job.salaryText}. ${verdict}${guessed}${approx}`
      : `${verdict}${approx}`,
    quote: facts?.quote,
  };
}

function levelChip(facts: ListingFacts | null, prefs: Preferences): Chip | null {
  const level = facts?.level?.level;
  if (!level) return null;
  const pref = prefs.levels.find((l) => l.level === level)?.preference;
  return {
    key: "level",
    label: JOB_LEVEL_LABELS[level],
    tone: pref ? LEVEL_TONE[pref] : EXTREME_LEVELS.includes(level) ? "info" : "muted",
    filled: EXTREME_LEVELS.includes(level) && pref !== "no" && pref !== "disliked",
    hint: facts?.levelFrom === "title" ? "From the job title." : "As the listing states it.",
    quote: facts?.level?.quote,
  };
}

function secondaryChips(job: JobChipInput, prefs: Preferences): Chip[] {
  const f = job.facts;
  const chips: Chip[] = [];
  const fit = job.fitChips ?? [];
  const FIT_TONE: Record<FitChip["kind"], ChipTone> = {
    conflict: "destructive",
    strength: "success",
    weakness: "warning",
  };
  const FIT_HINT: Record<FitChip["kind"], string> = {
    conflict: "The assessment found this conflicts with a hard requirement.",
    strength: "A strength the assessment found in the listing.",
    weakness: "A weakness the assessment found in the listing.",
  };
  fit.forEach((c, i) => {
    chips.push({
      key: `fit-${c.kind}-${i}`,
      label: short(c.label, 28),
      tone: FIT_TONE[c.kind],
      hint: FIT_HINT[c.kind],
      quote: c.quote,
    });
  });
  // Without labels (older assessments): just how many conflicts there are.
  if (job.hardConflicts && !fit.some((c) => c.kind === "conflict")) {
    chips.push({
      key: "conflicts",
      label: `${job.hardConflicts} hard conflict${job.hardConflicts === 1 ? "" : "s"}`,
      tone: "destructive",
      hint: "The assessment found conflicts with your hard requirements.",
    });
  }
  if (!f) return chips;
  for (const lang of f.languages) {
    const pref = prefs.languages.find((l) => same(l.name, lang.name))?.level;
    // Nice-to-haves only when they matter to you.
    if (!lang.required && pref !== "preferred" && pref !== "no") continue;
    chips.push({
      key: `lang-${lang.name}`,
      label: lang.required ? lang.name : `${lang.name} (plus)`,
      tone: pref ? LEVEL_TONE[pref] : "muted",
      hint: lang.required ? "A main language of the role." : "A plus, not required.",
      quote: lang.quote,
    });
  }
  for (const focus of f.roleFocus) {
    const pref = prefs.roleFocus.find((r) => r.focus === focus.focus)?.level;
    chips.push({
      key: `focus-${focus.focus}`,
      label: ROLE_FOCUS_LABELS[focus.focus],
      tone: pref ? LEVEL_TONE[pref] : "muted",
      hint: "What the role is mainly about.",
      quote: focus.quote,
    });
  }
  if (f.travel && f.travel.frequency !== "none") {
    const limit = prefs.travel.okUpTo;
    const over = limit
      ? TRAVEL_LIMITS.indexOf(f.travel.frequency) - TRAVEL_LIMITS.indexOf(limit)
      : 0;
    chips.push({
      key: "travel",
      label: `Travel: ${TRAVEL_LIMIT_LABELS[f.travel.frequency].toLowerCase()}`,
      tone: over >= 2 ? "destructive" : over === 1 ? "warning" : "muted",
      hint: limit
        ? `You're fine with ${TRAVEL_LIMIT_LABELS[limit].toLowerCase()}.`
        : "Travel the role needs.",
      quote: f.travel.quote,
    });
  }
  if (f.employmentType && f.employmentType.type !== "either") {
    chips.push({
      key: "employment",
      label: f.employmentType.type === "contractor" ? "Contract" : "Employee",
      tone: "muted",
      hint: "Employment type as the listing states it.",
      quote: f.employmentType.quote,
    });
  }
  if (f.timezone) {
    chips.push({
      key: "timezone",
      label: short(f.timezone.text, 22),
      tone: "muted",
      hint: "Working hours the listing asks for.",
      quote: f.timezone.quote,
    });
  }
  // Meaningful colors first, then neutral facts.
  const order: Record<ChipTone, number> = {
    destructive: 0,
    success: 1,
    warning: 2,
    info: 3,
    muted: 4,
  };
  return chips.sort((a, b) => order[a.tone] - order[b.tone]);
}

/** Chips input from a job list row (`JobOverview`): its facts and the latest assessment. */
export const overviewChipInput = (job: {
  facts: ListingFacts | null;
  eligibility: Eligibility | null;
  eligibilityQuote: string | null;
  summary: { salary?: string; counts: { hardConflicts: number }; fitChips?: FitChip[] } | null;
}): JobChipInput => ({
  facts: job.facts,
  eligibility: job.eligibility,
  eligibilityQuote: job.eligibilityQuote,
  salaryText: job.summary?.salary,
  hardConflicts: job.summary?.counts.hardConflicts,
  fitChips: job.summary?.fitChips,
});

/** The two chip lines of a job: always work mode and pay (and level when known); then extras. */
export function jobChips(
  job: JobChipInput,
  prefs: Preferences,
): { primary: Chip[]; secondary: Chip[] } {
  const level = levelChip(job.facts, prefs);
  return {
    primary: [workModeChip(job, prefs), salaryChip(job, prefs), ...(level ? [level] : [])],
    secondary: secondaryChips(job, prefs),
  };
}
