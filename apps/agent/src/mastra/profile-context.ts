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

/** Pending approvals of this chat, from the database (they survive compaction and restarts). */
export function formatPendingApprovals(pending: { id: string; summary: string }[]): string {
  if (pending.length === 0) return "Pending approvals in this chat: none.";
  return [
    "Pending approvals in this chat (waiting for the user in the app; not applied yet):",
    ...pending.map((p) => `- [approval:${p.id}] ${p.summary}`),
  ].join("\n");
}
