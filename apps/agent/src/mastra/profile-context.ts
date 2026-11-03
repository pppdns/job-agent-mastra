import type { ProfileFact } from "@copilot/db";
import { PROFILE_FACT_KINDS, PROFILE_FACT_LABELS } from "@copilot/shared";

/**
 * The approved profile as injected into the system prompt each turn. It comes from the
 * database, never from conversation summaries; fact ids let the agent propose exact changes.
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
      : [`${PROFILE_FACT_LABELS[kind]}s:`, ...items.map((f) => `- [fact:${f.id}] ${f.text}`)];
  });
  return [`Approved profile (version ${version}):`, ...sections].join("\n");
}
