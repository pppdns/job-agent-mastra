"use client";

import {
  type Assessment,
  assessmentSchema,
  assessmentSummary,
  type ResearchTopic,
  suggestedResearchTopics,
} from "@copilot/shared";
import { cn } from "cn";
import { ChevronDownIcon, ExternalLinkIcon, FileTextIcon } from "lucide-react";
import Link from "next/link";
import { AssessmentView, Points } from "@/components/assessment-view";
import { SummaryHeader, TONE_FILL, VERDICT } from "@/components/assessment-visuals";
import { ResearchSuggestions } from "@/components/research-suggestions";
import type { ToolPart } from "@/components/tool-trace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type DraftOutput = {
  ok?: boolean;
  jobId?: string;
  version?: number;
  title?: string | null;
  company?: string | null;
};

/** The assessment a successful save_job_draft call stored (its validated tool input). */
export function savedDraft(
  part: ToolPart,
): { assessment: Assessment; output: DraftOutput } | undefined {
  if (part.type !== "tool-save_job_draft" || part.state !== "output-available") return;
  const output = (part.output ?? {}) as DraftOutput;
  if (!output.ok) return;
  const parsed = assessmentSchema.safeParse((part.input as { assessment?: unknown })?.assessment);
  return parsed.success ? { assessment: parsed.data, output } : undefined;
}

/** A saved draft in the chat: summary at a glance, key points, full detail on demand. */
export function AssessmentCard({
  assessment,
  output,
  onResearch,
  researchDisabled,
}: {
  assessment: Assessment;
  output: DraftOutput;
  /** Shows "Research next" buttons; called with the topics picked. */
  onResearch?: (job: { jobId: string; company?: string | null; topics: ResearchTopic[] }) => void;
  researchDisabled?: boolean;
}) {
  const jobId = output.jobId;
  const summary = assessmentSummary(assessment);
  const job = [output.title, output.company].filter(Boolean).join(" · ") || "Job";
  return (
    <article
      aria-label="Assessment draft"
      className="relative overflow-hidden rounded-xl border border-dashed bg-card p-4 pl-5"
    >
      <span
        className={cn("absolute inset-y-0 left-0 w-1", TONE_FILL[VERDICT[summary.verdict].tone])}
      />
      <SummaryHeader
        summary={summary}
        title={
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <FileTextIcon className="size-4" />
            <span className="font-medium text-foreground">{job}</span>
            <Badge variant="outline">Draft v{output.version} · not approved</Badge>
            {output.jobId && (
              <Link
                href={`/jobs/${output.jobId}`}
                className="ml-auto inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline"
              >
                Open job <ExternalLinkIcon className="size-3" />
              </Link>
            )}
          </div>
        }
      />
      <div className="mt-4 flex flex-col gap-4 text-sm">
        {assessment.hardConflicts.length > 0 && (
          <Points kind="hardConflicts" points={assessment.hardConflicts} limit={2} />
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <Points kind="strengths" points={assessment.strengths} limit={3} />
          <Points kind="weaknesses" points={assessment.weaknesses} limit={3} />
        </div>
      </div>
      <Collapsible className="mt-3">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="group -ml-2 text-muted-foreground">
            <ChevronDownIcon className="transition-transform group-data-[state=open]:rotate-180" />
            Full assessment
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <AssessmentView assessment={assessment} showSummary={false} />
        </CollapsibleContent>
      </Collapsible>
      {onResearch && jobId && (
        <div className="mt-3 border-t pt-3">
          <ResearchSuggestions
            topics={suggestedResearchTopics(assessment)}
            disabled={researchDisabled}
            onResearch={(topics) => onResearch({ jobId, company: output.company, topics })}
          />
        </div>
      )}
    </article>
  );
}
