/** Drops fragments and tracking parameters so the same page dedupes by URL. */
export function canonicalWebUrl(url: URL): string {
  const copy = new URL(url.href);
  copy.hash = "";
  for (const key of [...copy.searchParams.keys()]) {
    if (/^(utm_|gh_src$|ref$|source$|trk$|lever-source)/i.test(key)) copy.searchParams.delete(key);
  }
  return copy.href;
}
