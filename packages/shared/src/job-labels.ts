// The user's own free-text job labels: shown in the UI only, never searched or sent to a model.

/** Most labels one job can carry. */
export const MAX_JOB_LABELS = 8;

/** Longest label, in characters. */
export const MAX_LABEL_LENGTH = 32;

/** One label as stored: trimmed, inner whitespace collapsed, cut to `MAX_LABEL_LENGTH`. */
export function normalizeLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH).trim();
}

/**
 * A job's labels as stored: each normalized, empty ones dropped, duplicates removed ignoring case
 * (the first spelling wins), at most `MAX_JOB_LABELS`.
 */
export function normalizeJobLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of labels) {
    const label = normalizeLabel(raw);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
    if (result.length === MAX_JOB_LABELS) break;
  }
  return result;
}
