// A minimal RSS 2.0 reader for job feeds: flat <item> elements with text children. Enough for
// the boards we read (We Work Remotely, NoDesk); not a general XML parser. Values are untrusted.

export type RssItem = Record<string, string>;

const MAX_ITEMS = 500;

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Decodes XML entities (and numeric ones); unknown named entities stay as they are for HTML. */
export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code =
        name[1] === "x" || name[1] === "X"
          ? Number.parseInt(name.slice(2), 16)
          : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    }
    return XML_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const text = (raw: string) => {
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return (cdata ? (cdata[1] ?? "") : decodeXml(raw)).trim();
};

/** The feed's items as tag → text (first occurrence of each child tag). */
export function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    if (items.length >= MAX_ITEMS) break;
    const item: RssItem = {};
    for (const child of (match[1] ?? "").matchAll(
      /<([a-zA-Z][\w:-]*)\b[^>]*?(?:\/>|>([\s\S]*?)<\/\1>)/g,
    )) {
      const tag = child[1] ?? "";
      if (!(tag in item)) item[tag] = text(child[2] ?? "");
    }
    items.push(item);
  }
  return items;
}

/** An RSS date ("Mon, 09 Nov 2026 13:57:42 +0000") or null. */
export function rssDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
