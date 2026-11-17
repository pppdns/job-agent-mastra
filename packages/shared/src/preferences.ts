import { z } from "zod";

// Structured preferences: the part of the approved profile that app code reads (chip colors,
// the screen, eligibility) and that every prompt gets as fixed sentences (`renderPreferences`),
// so code and models apply the same rules. Versioned with the profile facts; edited on /profile.

/** How the person feels about an option, best first. `no` is a deal-breaker. */
export const PREFERENCE_LEVELS = ["preferred", "ok", "disliked", "no"] as const;
export type PreferenceLevel = (typeof PREFERENCE_LEVELS)[number];

export const PREFERENCE_LEVEL_LABELS: Record<PreferenceLevel, string> = {
  preferred: "Preferred",
  ok: "OK",
  disliked: "Disliked",
  no: "No",
};

/** What a role mainly is about; a fixed list so listings and preferences use the same words. */
export const ROLE_FOCUS = [
  "applied_ai",
  "full_stack",
  "frontend",
  "backend",
  "infra_platform",
  "sre",
  "data_pipelines",
  "ml_research",
  "mobile",
  "embedded",
  "people_management",
  "customer_facing",
  "security",
] as const;
export type RoleFocus = (typeof ROLE_FOCUS)[number];

export const ROLE_FOCUS_LABELS: Record<RoleFocus, string> = {
  applied_ai: "Applied AI",
  full_stack: "Full stack",
  frontend: "Frontend",
  backend: "Backend",
  infra_platform: "Infra / platform",
  sre: "SRE / ops",
  data_pipelines: "Data pipelines",
  ml_research: "ML research / training",
  mobile: "Mobile",
  embedded: "Embedded",
  people_management: "People management",
  customer_facing: "Customer-facing / pre-sales",
  security: "Security",
};

export const JOB_LEVELS = [
  "junior",
  "mid",
  "senior",
  "staff",
  "principal",
  "lead",
  "head",
  "founding",
] as const;
export type JobLevel = (typeof JOB_LEVELS)[number];

export const JOB_LEVEL_LABELS: Record<JobLevel, string> = {
  junior: "Junior",
  mid: "Mid-level",
  senior: "Senior",
  staff: "Staff",
  principal: "Principal",
  lead: "Lead",
  head: "Head / director",
  founding: "Founding",
};

/** Most travel that is fine, least first. */
export const TRAVEL_LIMITS = ["none", "quarterly", "monthly", "frequent"] as const;
export type TravelLimit = (typeof TRAVEL_LIMITS)[number];

export const TRAVEL_LIMIT_LABELS: Record<TravelLimit, string> = {
  none: "No travel",
  quarterly: "A few times a year",
  monthly: "About monthly",
  frequent: "Frequent travel",
};

const level = z.enum(PREFERENCE_LEVELS);
const name = (max: number) => z.string().trim().min(1).max(max);
const placeLevels = z
  .array(z.object({ place: name(100), level }))
  .max(20)
  .default([]);

export const preferencesSchema = z.object({
  /** Where the person lives: decides which remote restrictions and offices are reachable. */
  home: z
    .object({ city: name(100), country: name(100) })
    .nullable()
    .default(null),
  workMode: z
    .object({
      remote: level.default("ok"),
      /** Hybrid in these places (matched like office locations). */
      hybrid: placeLevels,
      /** Hybrid anywhere else. */
      hybridElsewhere: level.default("ok"),
      onsite: placeLevels,
      onsiteElsewhere: level.default("ok"),
      /** Most office days a week that are fine for hybrid work. */
      maxOfficeDaysPerWeek: z.number().int().min(1).max(5).nullable().default(null),
    })
    .prefault({}),
  /** Yearly pay bands in one currency; pay in others is converted roughly. Colors chips only. */
  salary: z
    .object({
      /** Below this is not OK. */
      floor: z.number().positive().nullable().default(null),
      /** At or above this is great. */
      high: z.number().positive().nullable().default(null),
      currency: z
        .string()
        .trim()
        .regex(/^[A-Z]{3}$/)
        .default("EUR"),
    })
    .prefault({}),
  languages: z
    .array(z.object({ name: name(40), level }))
    .max(30)
    .default([]),
  roleFocus: z
    .array(z.object({ focus: z.enum(ROLE_FOCUS), level }))
    .max(ROLE_FOCUS.length)
    .default([]),
  levels: z
    .array(z.object({ level: z.enum(JOB_LEVELS), preference: level }))
    .max(JOB_LEVELS.length)
    .default([]),
  travel: z.object({ okUpTo: z.enum(TRAVEL_LIMITS).nullable().default(null) }).prefault({}),
});

export type Preferences = z.infer<typeof preferencesSchema>;
export type PreferencesInput = z.input<typeof preferencesSchema>;

export const DEFAULT_PREFERENCES: Preferences = preferencesSchema.parse({});

/** Parses a stored value; anything unreadable falls back to the defaults. */
export function parsePreferences(value: unknown): Preferences {
  const parsed = preferencesSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : DEFAULT_PREFERENCES;
}

/** Whether anything differs from the defaults (an untouched preferences block isn't rendered). */
export const hasPreferences = (p: Preferences) =>
  JSON.stringify(p) !== JSON.stringify(DEFAULT_PREFERENCES);

const PHRASE: Record<PreferenceLevel, string> = {
  preferred: "preferred",
  ok: "fine",
  disliked: "acceptable but disliked",
  no: "not acceptable (deal-breaker)",
};

const money = (n: number, currency: string) =>
  `${Math.round(n).toLocaleString("en-US")} ${currency}`;

/**
 * Fixed sentences for prompts, so models apply the rules code applies. Grouped by level: a `no`
 * is a hard requirement, everything else a soft preference. Empty when nothing is set.
 */
export function renderPreferences(p: Preferences): string[] {
  if (!hasPreferences(p)) return [];
  const lines: string[] = [];
  if (p.home) lines.push(`Lives in ${p.home.city}, ${p.home.country} (won't relocate).`);
  const wm = p.workMode;
  const places = (items: { place: string; level: PreferenceLevel }[], mode: string) =>
    items.map((i) => `${mode} in ${i.place}: ${PHRASE[i.level]}.`);
  lines.push(
    `Remote work${p.home ? ` (from ${p.home.country})` : ""}: ${PHRASE[wm.remote]}.`,
    ...places(wm.hybrid, "Hybrid"),
    `Hybrid elsewhere: ${PHRASE[wm.hybridElsewhere]}.`,
    ...places(wm.onsite, "On-site"),
    `On-site elsewhere: ${PHRASE[wm.onsiteElsewhere]}.`,
  );
  if (wm.maxOfficeDaysPerWeek) {
    lines.push(`Hybrid: at most ${wm.maxOfficeDaysPerWeek} office days a week.`);
  }
  const { floor, high, currency } = p.salary;
  if (floor) lines.push(`Pay below ${money(floor, currency)} a year: not OK.`);
  if (high) lines.push(`Pay at or above ${money(high, currency)} a year: great.`);
  const grouped = <T>(
    items: T[],
    label: (t: T) => string,
    levelOf: (t: T) => PreferenceLevel,
    what: string,
  ) =>
    PREFERENCE_LEVELS.flatMap((l) => {
      const names = items.filter((i) => levelOf(i) === l).map(label);
      return names.length ? [`${what} ${PHRASE[l]}: ${names.join(", ")}.`] : [];
    });
  lines.push(
    ...grouped(
      p.languages,
      (l) => l.name,
      (l) => l.level,
      "Main programming languages",
    ),
    ...grouped(
      p.roleFocus,
      (f) => ROLE_FOCUS_LABELS[f.focus],
      (f) => f.level,
      "Roles mainly about",
    ),
    ...grouped(
      p.levels,
      (l) => JOB_LEVEL_LABELS[l.level],
      (l) => l.preference,
      "Levels",
    ),
  );
  if (p.travel.okUpTo) {
    lines.push(
      `Travel: fine up to ${TRAVEL_LIMIT_LABELS[p.travel.okUpTo].toLowerCase()}; more is disliked.`,
    );
  }
  return lines;
}
