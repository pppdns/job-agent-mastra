import { factHandle, type ProfileFact } from "@copilot/db";
import { PROFILE_FACT_KINDS, PROFILE_FACT_LABELS } from "@copilot/shared";

/**
 * The approved profile as injected into the system prompt each turn. It comes from the
 * database, never from conversation summaries; fact handles (f7) let the agent cite facts and propose exact changes.
 */
export function formatProfile({
  version,
  facts,
}: {
  version: number;
  facts: ProfileFact[];
}): string {
  if (facts.length === 0) {
    return `Approved profile (version ${version}): empty. The user has not approved any profile facts yet.`;
  }
  const sections = PROFILE_FACT_KINDS.flatMap((kind) => {
    const items = facts.filter((f) => f.kind === kind);
    return items.length === 0
      ? []
      : [
          `${PROFILE_FACT_LABELS[kind]}s:`,
          ...items.map((f) => `- [fact:${factHandle(f)}] ${f.text}`),
        ];
  });
  return [`Approved profile (version ${version}):`, ...sections].join("\n");
}

/** Pending approvals of this chat, from the database (they survive compaction and restarts). */
export function formatPendingApprovals(pending: { id: string; summary: string }[]): string {
  if (pending.length === 0) return "Pending approvals in this chat: none.";
  return [
    "Pending approvals in this chat (waiting for the user in the app; not applied yet):",
    ...pending.map((p) => `- [approval:${p.id}] ${p.summary}`),
  ].join("\n");
}

/** Below this many approved facts (or with no hard requirement) the profile counts as thin. */
export const THIN_PROFILE_FACTS = 6;

/**
 * While the profile is thin, early assessments can't judge fit well, so the copilot asks the
 * few preferences that decide the job at hand. App code decides when; null once it's not thin.
 */
export function profileLearningHint(facts: Pick<ProfileFact, "kind">[]): string | null {
  const hasHardRequirement = facts.some((f) => f.kind === "hard_requirement");
  if (hasHardRequirement && facts.length >= THIN_PROFILE_FACTS) return null;
  return [
    `The approved profile is still thin (${facts.length} ${facts.length === 1 ? "fact" : "facts"}${hasHardRequirement ? "" : ", no hard requirements"}), so fit judgments are rough. Learn early:`,
    "- After saving an assessment, end the reply with one or two short questions about the user's preferences that would most change the verdict for this job (e.g. location or remote setup, seniority, salary floor, tech stack, deal-breakers). These questions don't count toward the reply's sentence limit.",
    "- Never ask about something the profile already covers, and never send a list of questions or a questionnaire.",
    "- When the user answers with a lasting preference, propose it with propose_profile_change, and mention that once approved, jobs assessed earlier can be re-scored.",
  ].join("\n");
}
