import {
  CircleAlertIcon,
  FileTextIcon,
  NotebookPenIcon,
  RotateCcwIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react";
import { EvidenceList } from "@/components/evidence-list";
import type { ToolPart } from "@/components/tool-trace";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";

/** A `data-research-progress` part as streamed by research_company. */
export type ProgressPart = {
  type: "data-research-progress";
  data:
    | { kind: "start"; company: string; topics: string[] }
    | { kind: "search"; query: string; results: number }
    | { kind: "read"; url: string; ok: boolean; note?: string }
    | { kind: "claim"; topic: string; evidence: string; text: string }
    | { kind: "retry"; what: string; attempt: number; reason: string }
    | { kind: "budget_limited"; reason: string }
    | { kind: "done"; status: string; claims: number };
};

export const isProgressPart = (part: { type: string }): part is ProgressPart =>
  part.type === "data-research-progress";

const LIMIT_REASONS: Record<string, string> = {
  tool_calls: "tool-call limit",
  time: "time limit",
  spend: "estimated spend limit",
};

/** Real progress of a research run: one line per event that actually happened. */
export function ResearchProgress({ parts, running }: { parts: ProgressPart[]; running: boolean }) {
  return (
    <Trace aria-label="Research progress">
      {parts.map((part, i) => {
        const e = part.data;
        const key = `${i}-${e.kind}`; // events are append-only
        switch (e.kind) {
          case "start":
            return <Line key={key} icon={<SparklesIcon />} title={`Researching ${e.company}`} />;
          case "search":
            return (
              <Line
                key={key}
                icon={<SearchIcon />}
                title={`Searched “${e.query}”`}
                description={`${e.results} results`}
              />
            );
          case "read":
            return (
              <Line
                key={key}
                icon={<FileTextIcon />}
                status={e.ok ? undefined : "error"}
                title={e.ok ? `Read ${e.url}` : `Couldn't read ${e.url}`}
                description={e.note}
              />
            );
          case "claim":
            return (
              <Line
                key={key}
                icon={<NotebookPenIcon />}
                title="Recorded a finding"
                description={e.text}
              />
            );
          case "retry":
            return (
              <Line
                key={key}
                icon={<RotateCcwIcon />}
                title={`Retrying ${e.what}`}
                description={`attempt ${e.attempt + 1}: ${e.reason}`}
              />
            );
          case "budget_limited":
            return (
              <Line
                key={key}
                icon={<CircleAlertIcon />}
                status="error"
                title="Stopped: research budget reached"
                description={LIMIT_REASONS[e.reason] ?? e.reason}
              />
            );
          case "done":
            return (
              <Line
                key={key}
                icon={<SparklesIcon />}
                title={e.status === "cancelled" ? "Research cancelled" : "Research finished"}
                description={`${e.claims} findings kept`}
              />
            );
          default:
            return null;
        }
      })}
      {running && <Line icon={<SparklesIcon />} status="running" title="Researching" />}
    </Trace>
  );
}

type ResearchOutput = {
  status?: string;
  reason?: string;
  claims?: {
    claimId: string;
    topic: never;
    text: string;
    evidence: never;
    sourceIds: string[];
    quote?: string | null;
    publishedAt?: string | null;
    eventDate?: string | null;
  }[];
  sources?: { sourceId: string; url: string | null }[];
  budget?: {
    toolCalls: number;
    elapsedMs: number;
    estimatedLlmUsd: number;
    estimatedProviderUsd: number;
  };
};

/** The finished research result: findings with evidence badges and the run's budget use. */
export function ResearchResult({ part }: { part: ToolPart }) {
  const output = (part.output ?? {}) as ResearchOutput;
  if (output.status === "unavailable") {
    return <p className="text-sm text-muted-foreground">Research unavailable: {output.reason}</p>;
  }
  const claims = output.claims ?? [];
  const b = output.budget;
  return (
    <Collapsible defaultOpen className="rounded-lg border p-3" aria-label="Research findings">
      <div className="flex flex-wrap items-center gap-2">
        <CollapsibleTrigger asChild>
          <Button variant="link" size="sm" className="h-auto px-0">
            {claims.length} findings
          </Button>
        </CollapsibleTrigger>
        {b && (
          <span className="text-xs text-muted-foreground">
            {b.toolCalls} web calls · {(b.elapsedMs / 1000).toFixed(0)} s · est. $
            {(b.estimatedLlmUsd + b.estimatedProviderUsd).toFixed(3)} (estimate)
          </span>
        )}
      </div>
      <CollapsibleContent className="pt-2">
        <EvidenceList
          claims={claims.map((c) => ({ ...c, id: c.claimId }))}
          sources={(output.sources ?? []).map((s) => ({ id: s.sourceId, url: s.url }))}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

function Line({
  icon,
  title,
  description,
  status,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  status?: "running" | "error";
}) {
  return (
    <TraceLine status={status}>
      <TraceIcon>{icon}</TraceIcon>
      <TraceTitle>{title}</TraceTitle>
      {description && <TraceDescription>{description}</TraceDescription>}
    </TraceLine>
  );
}
