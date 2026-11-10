import { z } from "zod";

// A job posting as a discovery source reports it, normalized across boards. Everything here
// comes from a third-party feed or scraper: untrusted data, validated and size-capped.

export const DISCOVERY_SOURCES = ["himalayas", "linkedin"] as const;
export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

export const DISCOVERY_SOURCE_LABELS: Record<DiscoverySource, string> = {
  himalayas: "Himalayas",
  linkedin: "LinkedIn",
};

/** Postings keep at most this much description (the full text goes into the job's snapshot). */
export const MAX_POSTING_DESCRIPTION_CHARS = 30_000;

const httpUrl = z
  .string()
  .max(2_000)
  .refine((u) => /^https?:\/\//i.test(u), "must be an http(s) URL");

export const SALARY_PERIODS = ["hour", "day", "week", "month", "year"] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

export const postingInputSchema = z.object({
  source: z.enum(DISCOVERY_SOURCES),
  /** The board's own id for the posting (stable across runs). */
  externalId: z.string().min(1).max(200),
  /** The posting on the board. */
  url: httpUrl,
  /** Where to apply, when it isn't the board itself (an ATS or company site). */
  applyUrl: httpUrl.nullable(),
  title: z.string().min(1).max(300),
  company: z.string().min(1).max(200),
  location: z.string().max(300).nullable(),
  /** true = remote, false = on-site or hybrid, null = the source doesn't say. */
  remote: z.boolean().nullable(),
  /** Countries or regions a remote role is limited to (empty = not stated or worldwide). */
  regions: z.array(z.string().max(100)).max(100),
  salaryMin: z.number().nonnegative().nullable(),
  salaryMax: z.number().nonnegative().nullable(),
  salaryCurrency: z.string().max(10).nullable(),
  salaryPeriod: z.enum(SALARY_PERIODS).nullable(),
  /** Pay exactly as the source wrote it, for the snapshot (assessments cite it). */
  salaryText: z.string().max(200).nullable(),
  seniority: z.string().max(100).nullable(),
  employmentType: z.string().max(100).nullable(),
  postedAt: z.date().nullable(),
  /** Markdown or plain text. */
  description: z.string().max(MAX_POSTING_DESCRIPTION_CHARS),
});

export type PostingInput = z.infer<typeof postingInputSchema>;

/** Lowercase, accents removed, punctuation collapsed to single spaces. */
export const normalizeText = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const LEGAL_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "plc",
  "corp",
  "corporation",
  "co",
  "company",
  "gmbh",
  "ag",
  "sa",
  "sas",
  "sarl",
  "srl",
  "spa",
  "bv",
  "nv",
  "oy",
  "ab",
  "as",
  "aps",
  "kft",
  "zrt",
  "sp",
  "zoo",
  "pty",
  "pte",
  "kk",
]);

/**
 * A company name reduced for matching across boards: "Acme, Inc." = "ACME Inc" = "acme".
 * Trailing legal forms and a leading "the" are dropped; the core name is never emptied.
 */
export function companyKey(name: string): string {
  const words = normalizeText(name).split(" ").filter(Boolean);
  if (words[0] === "the" && words.length > 1) words.shift();
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1] ?? "")) words.pop();
  return words.join(" ");
}

/** Text header that starts a board snapshot, so stored listings state date, pay and place. */
export function postingSnapshot(posting: PostingInput, sourceLabel: string): string {
  const header = [
    `# ${posting.title}`,
    "",
    `Company: ${posting.company}`,
    posting.location && `Location: ${posting.location}`,
    posting.remote === true &&
      `Remote: yes${posting.regions.length > 0 ? ` (${posting.regions.join(", ")})` : ""}`,
    posting.salaryText && `Salary: ${posting.salaryText}`,
    posting.seniority && `Seniority: ${posting.seniority}`,
    posting.employmentType && `Employment type: ${posting.employmentType}`,
    posting.postedAt && `Posted: ${posting.postedAt.toISOString().slice(0, 10)}`,
    `Source: ${sourceLabel}`,
  ].filter((line): line is string => typeof line === "string");
  return `${header.join("\n")}\n\n${posting.description}`;
}
