// Pure parsing of provider markdown into listing fields, plus completeness rules.
// Never treat a sign-in page, search page or snippet as a listing (see docs/spikes/extraction.md).

import { RELATIVE_AGE } from "@copilot/shared";

export const MAX_DESCRIPTION_CHARS = 20_000;
export const MIN_LINKEDIN_DESCRIPTION_WORDS = 80;
export const MIN_PAGE_WORDS = 150;

export type ListingFields = {
  title?: string;
  company?: string;
  location?: string;
  description: string;
  criteria: Record<string, string>;
};

export type Completeness =
  | { complete: true }
  | { complete: false; reason: "no_listing" | "incomplete"; detail: string };

export type ParsedPage = ListingFields & { completeness: Completeness };

/** LinkedIn job id from /jobs/view/<id>, /jobs/view/<slug>-<id> or ?currentJobId=<id>. */
export function linkedInJobId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
  const view = url.pathname.match(/^\/jobs\/view\/(?:[^/]*-)?(\d{6,})\/?$/);
  if (view?.[1]) return view[1];
  const current = url.searchParams.get("currentJobId");
  return current && /^\d{6,}$/.test(current) ? current : null;
}

export const isLinkedInHost = (url: URL) => /(^|\.)linkedin\.com$/i.test(url.hostname);

export const canonicalLinkedInUrl = (jobId: string) =>
  `https://www.linkedin.com/jobs/view/${jobId}/`;

/** Strips links/images to their text, collapses whitespace per line. */
export function cleanMarkdown(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const wordCount = (text: string) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;

const bound = (text: string) => text.slice(0, MAX_DESCRIPTION_CHARS);

// Raw lines that are only links back into LinkedIn (profiles, sign-in, save, report).
const LINKEDIN_LINK_ONLY =
  /^\s*(\*\s+)?(\[[^\]]*\]\((https?:\/\/[^)]*linkedin\.com|\/)[^)]*\)\s*)+$/;

// Guest-page chrome (after link cleanup) between the job card and the description.
const LINKEDIN_NOISE = [
  /^#{1,6} /, // headings: sign-in prompts, recruiter card name/title
  /^(or|Join now|Save|New to LinkedIn\?.*|Join to apply for .*)$/i,
  /^By clicking Continue/i,
  /^\* Report this job$/i,
  /^Show more Show less$/i,
  /^Referrals increase your chances/i,
  /^Join to save .*/i,
  /^Get AI-powered advice/i,
  /^Direct message the job poster/i,
];

// The card's posting age and everything after it (applicant count); see listingPostedDate.
const AGE_AND_REST = new RegExp(`\\s+${RELATIVE_AGE.source}.*$`, "i");

/** Parses LinkedIn's public guest job page as returned by Tavily extract. */
export function parseLinkedInPage(markdown: string): ParsedPage {
  const lines = markdown.split("\n");
  const titleIndex = lines.findIndex((l) => /^# \S/.test(l));
  const cardLine = titleIndex >= 0 ? nextNonEmpty(lines, titleIndex + 1) : undefined;
  const card = cardLine?.match(
    /^#### \[([^\]]+)\]\(https?:\/\/[^)]*linkedin\.com\/company\/[^)]*\)\s*(.*)$/,
  );
  const criteriaIndex = lines.findIndex((l) => /^\*\s+### Seniority level/.test(l));

  if (titleIndex < 0 || !card) {
    return {
      description: "",
      criteria: {},
      completeness: {
        complete: false,
        reason: "no_listing",
        detail: "LinkedIn returned a sign-in, search or other page instead of a job listing",
      },
    };
  }

  const title = lines[titleIndex]?.slice(2).trim();
  const company = card[1]?.trim();
  const location = cleanMarkdown(card[2] ?? "")
    .replace(AGE_AND_REST, "")
    .trim();

  const end = criteriaIndex >= 0 ? criteriaIndex : lines.length;
  const bodyLines = lines
    .slice(lines.indexOf(cardLine ?? "") + 1, end)
    .filter((line) => !LINKEDIN_LINK_ONLY.test(line));
  const description = cleanMarkdown(bodyLines.join("\n"))
    .split("\n")
    .filter((line) => !LINKEDIN_NOISE.some((re) => re.test(line.trim())))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const criteria = criteriaIndex >= 0 ? parseCriteria(lines.slice(criteriaIndex)) : {};

  const words = wordCount(description);
  const completeness: Completeness =
    criteriaIndex < 0
      ? { complete: false, reason: "incomplete", detail: "the job criteria section is missing" }
      : words < MIN_LINKEDIN_DESCRIPTION_WORDS
        ? { complete: false, reason: "incomplete", detail: `description has only ${words} words` }
        : { complete: true };

  return { title, company, location, description: bound(description), criteria, completeness };
}

/** Parses a non-LinkedIn page (company or ATS posting). Title and company come from the caller's expectations. */
export function parseGenericPage(markdown: string): ParsedPage {
  const text = cleanMarkdown(markdown);
  const title = text.match(/^# (.+)$/m)?.[1]?.trim();
  const words = wordCount(text);
  const completeness: Completeness =
    words >= MIN_PAGE_WORDS
      ? { complete: true }
      : {
          complete: false,
          reason: words < 40 ? "no_listing" : "incomplete",
          detail: `page has only ${words} words of text`,
        };
  return { title, description: bound(text), criteria: {}, completeness };
}

/** Listing fields from a stored source, parsed the same way as when it was ingested. */
export function parseStoredListing(kind: string, content: string): ListingFields {
  const { completeness: _, ...fields } =
    kind === "linkedin" ? parseLinkedInPage(content) : parseGenericPage(content);
  return fields;
}

function nextNonEmpty(lines: string[], from: number): string | undefined {
  return lines.slice(from).find((l) => l.trim() !== "");
}

function parseCriteria(lines: string[]): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const label = lines[i]?.match(/^\*\s+### (.+)$/)?.[1]?.trim();
    if (!label) {
      if (/^## /.test(lines[i] ?? "")) break;
      continue;
    }
    const value = nextNonEmpty(lines, i + 1)?.trim();
    if (value && !value.startsWith("*")) criteria[label] = value;
  }
  return criteria;
}

/**
 * Identity check for an employer/ATS page found by search: the expected title must be the
 * page's heading (or appear verbatim) and the full company name must appear in the text.
 */
const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export function matchesIdentity(page: ParsedPage, expected: { title: string; company: string }) {
  const text = ` ${normalize(page.description)} `;
  const title = normalize(expected.title);
  const titleOk = normalize(page.title ?? "") === title || text.includes(` ${title} `);
  const companyOk = text.includes(` ${normalize(expected.company)} `);
  return titleOk && companyOk;
}
