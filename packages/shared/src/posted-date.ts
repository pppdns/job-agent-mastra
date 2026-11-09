// When the company posted a job, read deterministically from a stored listing snapshot.
// LinkedIn only gives a relative age ("3 weeks ago") as of the time the page was read, so those
// dates are approximate; employer pages sometimes state an explicit date.

/** `exact`: the page stated a date. `relative`/`reposted`: derived from "N units ago". */
export const POSTED_BASES = ["exact", "relative", "reposted"] as const;
export type PostedBasis = (typeof POSTED_BASES)[number];

export type PostedDate = { postedAt: Date; basis: PostedBasis };

/** "3 weeks ago", "Reposted 1 day ago" (LinkedIn's job card age). */
export const RELATIVE_AGE = /(Reposted\s+)?(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago\b/i;

const OWN_LINE_AGE = new RegExp(`^${RELATIVE_AGE.source}$`, "i");
/** Lines under the LinkedIn card that can still hold its age (applicants, apply button). */
const CARD_LINES_BELOW = 3;

const DAY_MS = 86_400_000;
const UNIT_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
  year: 365 * DAY_MS,
};

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;
const MONTH =
  "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const LABEL = /^(?:date posted|posted on|posted|published on|published)\s*:?\s*/i;
const ISO = /^(\d{4})-(\d{2})-(\d{2})\b/;
const DAY_MONTH_YEAR = new RegExp(
  `^(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}\\.?,?\\s+(\\d{4})\\b`,
  "i",
);
const MONTH_DAY_YEAR = new RegExp(
  `^${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`,
  "i",
);

/** Earliest plausible posting date; anything before is a parse error. */
const MIN_DATE = Date.UTC(2000, 0, 1);

/**
 * The posting date a listing snapshot states, or null. For LinkedIn only the job card under the
 * title counts (the same "N ago" text also appears in "similar jobs" lists further down).
 */
export function listingPostedDate(
  kind: string,
  content: string,
  retrievedAt: Date,
): PostedDate | null {
  const found =
    kind === "linkedin" ? linkedInAge(content, retrievedAt) : statedDate(content, retrievedAt);
  if (!found) return null;
  const t = found.postedAt.getTime();
  if (Number.isNaN(t) || t < MIN_DATE || t > retrievedAt.getTime() + DAY_MS) return null;
  return found;
}

function relative(match: RegExpMatchArray, retrievedAt: Date): PostedDate | null {
  const [, reposted, amount, unit] = match;
  const ms = UNIT_MS[unit?.toLowerCase() ?? ""];
  if (!ms || !amount) return null;
  return {
    postedAt: new Date(retrievedAt.getTime() - Number(amount) * ms),
    basis: reposted ? "reposted" : "relative",
  };
}

function linkedInAge(content: string, retrievedAt: Date): PostedDate | null {
  const lines = content.split("\n");
  const titleIndex = lines.findIndex((l) => /^# \S/.test(l));
  if (titleIndex < 0) return null;
  const cardIndex = lines.findIndex((l, i) => i > titleIndex && l.trim() !== "");
  const card = lines[cardIndex];
  if (!card || !/^#### \[[^\]]+\]\(https?:\/\/[^)]*linkedin\.com\/company\//.test(card)) {
    return null;
  }
  const inline = card.match(RELATIVE_AGE);
  if (inline) return relative(inline, retrievedAt);
  // Some extracts put the age on its own line under the card ("\n\n 1 week ago \n\n").
  const below = lines
    .slice(cardIndex + 1)
    .filter((l) => l.trim() !== "")
    .slice(0, CARD_LINES_BELOW)
    .map((l) => l.trim().match(OWN_LINE_AGE))
    .find(Boolean);
  return below ? relative(below, retrievedAt) : null;
}

/** First "Posted on <date>" / "Date posted: <date>" / "Posted N days ago" line. */
function statedDate(content: string, retrievedAt: Date): PostedDate | null {
  for (const raw of content.split("\n")) {
    const line = raw
      .replace(/^\s*(?:[-*+]\s+|#{1,6}\s+)?/, "")
      .replace(/[*_`]/g, "")
      .trim();
    const label = line.match(LABEL);
    if (!label) continue;
    const rest = line.slice(label[0].length);
    const date = parseDate(rest);
    if (date) return { postedAt: date, basis: "exact" };
    const age = rest.match(new RegExp(`^${RELATIVE_AGE.source}`, "i"));
    if (age) return relative(age, retrievedAt);
  }
  return null;
}

function parseDate(text: string): Date | null {
  const iso = text.match(ISO);
  if (iso) return utc(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dmy = text.match(DAY_MONTH_YEAR);
  if (dmy) return utc(Number(dmy[3]), monthIndex(dmy[2]), Number(dmy[1]));
  const mdy = text.match(MONTH_DAY_YEAR);
  if (mdy) return utc(Number(mdy[3]), monthIndex(mdy[1]), Number(mdy[2]));
  return null;
}

const monthIndex = (name = "") =>
  MONTHS.indexOf(name.slice(0, 3).toLowerCase() as (typeof MONTHS)[number]);

function utc(year: number, month: number, day: number): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month, day));
  // Rejects overflow such as 31 February.
  return date.getUTCMonth() === month ? date : null;
}
