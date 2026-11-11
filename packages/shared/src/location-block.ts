import { z } from "zod";
import { normalizeText } from "./posting";

// A location block: the listing explicitly limits where the hire may live or work, and the
// person is outside those places. Triage and assessments report one with a verbatim quote; app
// code checks the quote against the stored listing and hides the job (see `visibleJobs`).

export const locationBlockSchema = z
  .object({
    places: z
      .array(z.string().trim().min(1).max(80))
      .min(1)
      .max(10)
      .describe("Where the hire must be, as the listing says, e.g. ['United States']"),
    quote: z
      .string()
      .trim()
      .min(3)
      .max(300)
      .describe("The listing's own words stating the restriction, copied verbatim"),
  })
  .nullable();

export type LocationBlock = NonNullable<z.infer<typeof locationBlockSchema>>;

/** What a job stores: the block and which step found it. */
export type StoredLocationBlock = LocationBlock & { from: "triage" | "assessment" };

/** When to report a location block; the same rule for triage and full assessments. */
export const LOCATION_BLOCK_RULE = `locationBlock: set it only when the posting explicitly limits where the hire may live or work (e.g. "US-only", "Remote (United States)", "must reside in the UK", "only candidates based in Canada"), the person's location in the profile is outside every place it allows, and it offers no way to work from elsewhere. places lists the allowed places; quote copies the posting's words exactly (a header line like "Remote: yes (United States)" counts). Leave it null when the signal is weaker or unclear: time-zone overlap ("US hours", "EST overlap"), where the company is based, "preferred" or "ideally", one office city on a remote posting, work authorization or visa wording without a place of residence, a contradictory location, or when the profile doesn't say where the person lives.`;

/** Whether `quote` appears in one of `texts`, ignoring case, accents and punctuation. */
export function quoteInSources(quote: string, texts: readonly string[]): boolean {
  const wanted = normalizeText(quote);
  if (wanted.length < 3) return false;
  return texts.some((t) => ` ${normalizeText(t)} `.includes(` ${wanted} `));
}

/** One line for lists: "Only hires in United States: “Remote (US-only)”". */
export function locationBlockReason(block: LocationBlock): string {
  const quote = block.quote.length > 120 ? `${block.quote.slice(0, 119)}…` : block.quote;
  return `only hires in ${block.places.slice(0, 3).join(", ")}: “${quote}”`;
}
