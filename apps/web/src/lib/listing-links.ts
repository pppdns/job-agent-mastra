type ListingSource = { kind: string; url: string | null };

export type ListingLink = { url: string; label: string; host: string };

const LABELS: Record<string, string> = { linkedin: "LinkedIn listing", ats: "Employer posting" };

/** Only http(s) URLs become links (a stored `javascript:` URL must never be clickable). */
function parseHttpUrl(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * The original job listing URLs: the job's canonical URL first, then listing sources
 * (LinkedIn, employer postings), deduplicated. Research pages and pasted text don't count.
 */
export function listingLinks(
  canonicalUrl: string | null,
  sources: readonly ListingSource[],
  /** Discovery postings (jobs found by discovery often have no canonical URL or listing source). */
  postings: readonly { url: string; applyUrl: string | null; sourceLabel: string }[] = [],
): ListingLink[] {
  const candidates: { kind: string; url: string | null; label?: string }[] = [
    { kind: sources.find((s) => s.url === canonicalUrl)?.kind ?? "", url: canonicalUrl },
    ...sources.filter((s) => s.kind in LABELS),
    ...postings.flatMap((p) => [
      { kind: "", url: p.applyUrl, label: "Apply page" },
      { kind: "", url: p.url, label: `${p.sourceLabel} listing` },
    ]),
  ];
  const links: ListingLink[] = [];
  for (const { kind, url: raw, label: given } of candidates) {
    const url = parseHttpUrl(raw);
    if (!url || links.some((l) => l.url === url.href)) continue;
    const host = url.hostname.replace(/^www\./, "");
    const label =
      given ?? LABELS[kind] ?? (host.endsWith("linkedin.com") ? LABELS.linkedin : "Listing");
    links.push({ url: url.href, label, host });
  }
  return links;
}
