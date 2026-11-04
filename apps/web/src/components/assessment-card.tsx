"use client";

import {
  type Assessment,
  assessmentSchema,
  assessmentSummary,
  type ResearchTopic,
  suggestedResearchTopics,
} from "@copilot/shared";
import { cn } from "cn";
import { ExternalLinkIcon, FileTextIcon } from "lucide-react";
import Link from "next/link";
import { AssessmentView } from "@/components/assessment-view";
import { SummaryHeader, TONE_FILL, VERDICT } from "@/components/assessment-visuals";
import { ResearchSuggestions } from "@/components/research-suggestions";
import type { ToolPart } from "@/components/tool-trace";
import { Badge } from "@/components/ui/badge";

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

/** A saved assessment in the chat: summary header, then the full assessment. */
export function AssessmentCard({
  assessment,
  output,
  onResearch,
  researchDisabled,
}: {
  assessment: Assessment;
  output: DraftOutput;
  /** Shows "Research next" buttons; called with the topics picked. */
  onResearch?: (job: { jobId: string; topics: ResearchTopic[] }) => void;
  researchDisabled?: boolean;
}) {
  const jobId = output.jobId;
  const summary = assessmentSummary(assessment);
  const job = [output.title, output.company].filter(Boolean).join(" · ") || "Job";
  return (
    <article
      aria-label="Saved assessment"
      className="relative overflow-hidden rounded-xl border bg-card p-4 pl-5"
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
            <Badge variant="secondary">Saved · v{output.version}</Badge>
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
      <div className="mt-4">
        <AssessmentView assessment={assessment} showSummary={false} />
      </div>
      {onResearch && jobId && (
        <div className="mt-3 border-t pt-3">
          <ResearchSuggestions
            topics={suggestedResearchTopics(assessment)}
            disabled={researchDisabled}
            onResearch={(topics) => onResearch({ jobId, topics })}
          />
        </div>
      )}
    </article>
  );
}
