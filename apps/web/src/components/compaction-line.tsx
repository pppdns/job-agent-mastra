import { ArchiveIcon } from "lucide-react";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";

/** Observational Memory parts that mean context was (or failed to be) compacted. */
const COMPACTION_PARTS = new Set([
  "data-om-activation",
  "data-om-observation-end",
  "data-om-observation-failed",
]);

export type CompactionPart = { type: string; data?: { operationType?: string } };

export const isCompactionPart = (part: { type: string }): part is CompactionPart =>
  COMPACTION_PARTS.has(part.type);

/** Other OM parts (status, buffering) are internal; never rendered. */
export const isHiddenMemoryPart = (part: { type: string }) =>
  part.type.startsWith("data-om-") && !isCompactionPart(part);

export function CompactionLine({ part }: { part: CompactionPart }) {
  const failed = part.type === "data-om-observation-failed";
  const reflection = part.data?.operationType === "reflection";
  return (
    <Trace>
      <TraceLine status={failed ? "error" : undefined}>
        <TraceIcon>
          <ArchiveIcon />
        </TraceIcon>
        <TraceTitle>
          {failed
            ? "Couldn't compact earlier messages"
            : reflection
              ? "Condensed this chat's memory"
              : "Compacted earlier messages"}
        </TraceTitle>
        <TraceDescription>
          originals kept in storage; profile and approvals unaffected
        </TraceDescription>
      </TraceLine>
    </Trace>
  );
}
