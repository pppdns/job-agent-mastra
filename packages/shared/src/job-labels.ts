import { z } from "zod";

// The user's own labels on one job: shown in the UI only, never searched or sent to a model.
// Important ones are the user's top priority (e.g. an urgent action) and always come first.

/** Most labels one job can carry. */
export const MAX_JOB_LABELS = 8;

/** Longest label, in characters. */
export const MAX_LABEL_LENGTH = 32;

export const jobLabelSchema = z.object({
  text: z.string().max(200),
  important: z.boolean(),
});
export type JobLabel = z.infer<typeof jobLabelSchema>;

/** One label's text as stored: trimmed, inner whitespace collapsed, cut to `MAX_LABEL_LENGTH`. */
export function normalizeLabelText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH).trim();
}

/**
 * A job's labels as stored: text normalized, empty ones dropped, duplicates merged ignoring case
 * (the first spelling wins, important if any copy was), at most `MAX_JOB_LABELS`, important
 * ones first and otherwise in the order they were added.
 */
export function normalizeJobLabels(labels: readonly JobLabel[]): JobLabel[] {
  const byKey = new Map<string, JobLabel>();
  for (const { text: raw, important } of labels) {
    const text = normalizeLabelText(raw);
    if (!text) continue;
    const key = text.toLowerCase();
    const seen = byKey.get(key);
    if (seen) seen.important ||= important;
    else byKey.set(key, { text, important });
  }
  const all = [...byKey.values()];
  return [...all.filter((l) => l.important), ...all.filter((l) => !l.important)].slice(
    0,
    MAX_JOB_LABELS,
  );
}
