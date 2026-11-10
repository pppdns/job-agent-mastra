import { MAX_POSTING_DESCRIPTION_CHARS } from "@copilot/shared";
import { NodeHtmlMarkdown } from "node-html-markdown";

// Board descriptions arrive as HTML or run-together text. Untrusted: links and images are
// reduced to their text so nothing stored or shown later points anywhere.

const converter = new NodeHtmlMarkdown({ ignore: ["img", "script", "style", "iframe"] });

/** HTML → bounded markdown without links or images. */
export function htmlToText(html: string): string {
  return plainMarkdown(converter.translate(html));
}

/** Markdown/text with links reduced to their text, blank runs collapsed, bounded. */
export function plainMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_POSTING_DESCRIPTION_CHARS);
}

/** Trimmed string or null (empty strings count as missing). */
export const str = (v: unknown, max = 300): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null;

/** A finite non-negative number or null. */
export const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

/** http(s) URL or null. */
export const httpUrl = (v: unknown): string | null => {
  const s = str(v, 2_000);
  return s && /^https?:\/\//i.test(s) ? s : null;
};

/**
 * A board's free-text remote region ("USA Only", "Anywhere in the World", "Europe, UK") as
 * region names for the screen. Unclear text gives [] (not stated), which the screen passes.
 */
export function regionList(text: string | null | undefined): string[] {
  const value = text?.trim();
  if (!value || value.length > 300) return [];
  if (/\b(anywhere|worldwide|global(ly)?)\b/i.test(value)) return ["Worldwide"];
  return value
    .split(/[,;/|]|\s+(?:or|and|&)\s+/i)
    .map((part) =>
      part
        .replace(/\([^)]*\)/g, "")
        .replace(/\b(only|remote|based|time ?zones?)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((part) => part.length > 1 && part.length <= 60)
    .slice(0, 20);
}
