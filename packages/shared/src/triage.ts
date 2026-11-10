import { z } from "zod";

// The cheap first look a discovered job gets: how well it fits the profile (0–100) and why,
// in one line. Full assessments (assessment.ts) are kept for the best matches.

export const MAX_TRIAGE_REASON_CHARS = 240;

export const triageSchema = z.object({
  /** 0–100: how worth a closer look this job is for this person. */
  score: z.number().int().min(0).max(100),
  /** One line, citing the deciding facts (role, place, pay, requirements). */
  reason: z.string().min(1).max(MAX_TRIAGE_REASON_CHARS),
  /** A hard requirement of the profile the job clearly breaks, if any. */
  hardConflict: z.string().max(200).nullable(),
});

export type Triage = z.infer<typeof triageSchema>;

/** What a triage score means on screen. */
export function triageBand(score: number): "strong" | "good" | "mixed" | "weak" {
  if (score >= 80) return "strong";
  if (score >= 60) return "good";
  if (score >= 40) return "mixed";
  return "weak";
}
