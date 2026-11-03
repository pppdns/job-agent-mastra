const SECRET_KEY = /(api[-_]?key|token|secret|password|authorization|cookie|credential)/i;
/** Fields that hold page or listing text: never copied into run events. */
const BULK_KEY = /^(untrustedText|raw_content|content|description|text|markdown|html)$/;
const MAX_STRING = 300;
const MAX_ITEMS = 10;
const MAX_DEPTH = 3;

/**
 * Small, secret-free copy of tool arguments or results for the technical panel: drops
 * secret-looking keys and bulky page text, truncates strings and arrays, limits depth.
 */
export function sanitizeForEvent(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}… (${value.length} chars)`
      : value;
  }
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? `[${value.length} items]` : "{…}";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((v) => sanitizeForEvent(v, depth + 1));
    return value.length > MAX_ITEMS ? [...items, `… ${value.length - MAX_ITEMS} more`] : items;
  }
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) out[key] = "[redacted]";
    else if (BULK_KEY.test(key) && typeof v === "string" && v.length > 80)
      out[key] = `[${v.length} chars omitted]`;
    else out[key] = sanitizeForEvent(v, depth + 1);
  }
  return out;
}
