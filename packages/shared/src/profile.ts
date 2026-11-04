import { z } from "zod";

export const PROFILE_FACT_KINDS = ["hard_requirement", "soft_preference", "background"] as const;
export type ProfileFactKind = (typeof PROFILE_FACT_KINDS)[number];

export const PROFILE_FACT_LABELS: Record<ProfileFactKind, string> = {
  hard_requirement: "Hard requirement",
  soft_preference: "Soft preference",
  background: "Background",
};

const factText = z.string().trim().min(3).max(400);
const factId = z.string().min(1).max(64).describe("The fact's handle, e.g. f7");

/** One exact change to the approved profile, as proposed by the agent or the profile page. */
export const profileChangeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), kind: z.enum(PROFILE_FACT_KINDS), text: factText }),
  z.object({
    op: z.literal("modify"),
    factId,
    kind: z.enum(PROFILE_FACT_KINDS).optional().describe("New kind; omit to keep it"),
    text: factText,
  }),
  z.object({ op: z.literal("remove"), factId }),
]);
export type ProfileChange = z.infer<typeof profileChangeSchema>;

export const profileProposalSchema = z.object({
  changes: z.array(profileChangeSchema).min(1).max(10),
  reason: z.string().trim().min(3).max(300).describe("What the user said that prompts this change"),
});
export type ProfileProposal = z.infer<typeof profileProposalSchema>;
