import { z } from "zod";
import { locationBlockSchema } from "./location-block";

// The cheap first look a discovered job gets: how well it fits the profile (0–100) and why,
// in one line. Full assessments (assessment.ts) are kept for the best matches.

/** Stored length of a reason (longer ones are cut with "…"). */
export const MAX_TRIAGE_REASON_CHARS = 240;
/** Accepted from the model: a reason a bit over the target is cut, not a failed call. */
const MAX_MODEL_REASON_CHARS = 1_000;

export const triageSchema = z.object({
  /** 0–100: how worth a closer look this job is for this person. */
  score: z.number().int().min(0).max(100),
  /** One line, citing the deciding facts (role, place, pay, requirements). */
  reason: z.string().min(1).max(MAX_MODEL_REASON_CHARS),
  /** A hard requirement of the profile the job clearly breaks, if any. */
  hardConflict: z.string().max(200).nullable(),
  /** The posting explicitly excludes where the person lives (verified against the posting). */
  locationBlock: locationBlockSchema.default(null),
});

export type Triage = z.infer<typeof triageSchema>;
/** A triage as given (the location block may be left out). */
export type TriageInput = z.input<typeof triageSchema>;

/** A reason cut to the stored length at a word boundary. */
export function shortReason(reason: string, max = MAX_TRIAGE_REASON_CHARS): string {
  const text = reason.trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max / 2)).trimEnd()}…`;
}

/** What a triage score means on screen. */
export function triageBand(score: number): "strong" | "good" | "mixed" | "weak" {
  if (score >= 80) return "strong";
  if (score >= 60) return "good";
  if (score >= 40) return "mixed";
  return "weak";
}
