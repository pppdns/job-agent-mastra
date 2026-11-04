"use client";

import {
  type FitLevel,
  RECOMMENDATION_LABELS,
  RECOMMENDATIONS,
  type Recommendation,
} from "@copilot/shared";
import { ArrowRightIcon, CheckIcon, CircleAlertIcon, RefreshCwIcon } from "lucide-react";
import Link from "next/link";
import { FitMeter, VerdictBadge } from "@/components/assessment-visuals";
import type { ToolPart } from "@/components/tool-trace";
import { Badge } from "@/components/ui/badge";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";

type JobResult = {
  jobId: string;
  title: string | null;
  company: string | null;
} & (
  | {
      status: "saved";
      draftId: string;
      version: number;
      before: { verdict?: string; fitLevel?: string };
      after: { verdict: string; fitLevel?: string; headline?: string };
    }
  | { status: "failed"; reason: string }
);

/** A `data-rescore-progress` part as streamed by rescore_jobs. */
export type RescorePart = {
  type: "data-rescore-progress";
  data:
    | { kind: "start"; total: number; skipped: number; profileVersion: number }
    | ({ kind: "job" } & JobResult)
    | { kind: "done"; status: string; saved: number; failed: number };
};

export const isRescorePart = (part: { type: string }): part is RescorePart =>
  part.type === "data-rescore-progress";

const label = (j: { title: string | null; company: string | null }) =>
  [j.title ?? "Untitled job", j.company].filter(Boolean).join(" · ");

const verdictLabel = (v?: string) =>
  v && v in RECOMMENDATION_LABELS ? RECOMMENDATION_LABELS[v as Recommendation] : "no verdict";

/** Live progress of a re-score batch: one line per job as it finishes. */
export function RescoreProgress({ parts, running }: { parts: RescorePart[]; running: boolean }) {
  return (
    <Trace aria-label="Re-score progress">
      {parts.map((part, i) => {
        const e = part.data;
        const key = `${i}-${e.kind}`; // events are append-only
        switch (e.kind) {
          case "start":
            return (
              <Line
                key={key}
                icon={<RefreshCwIcon />}
                title={`Re-scoring ${e.total} ${e.total === 1 ? "job" : "jobs"} against profile v${e.profileVersion}`}
                description={
                  e.skipped > 0 ? `${e.skipped} more left for the next batch` : undefined
                }
              />
            );
          case "job":
            return e.status === "saved" ? (
              <Line
                key={key}
                icon={<CheckIcon />}
                title={label(e)}
                description={`${verdictLabel(e.before.verdict)} → ${verdictLabel(e.after.verdict)}`}
              />
            ) : (
              <Line
                key={key}
                icon={<CircleAlertIcon />}
                status="error"
                title={label(e)}
                description={e.reason}
              />
            );
          case "done":
            return (
              <Line
                key={key}
                icon={<RefreshCwIcon />}
                title={e.status === "cancelled" ? "Re-score stopped" : "Re-score finished"}
                description={`${e.saved} saved${e.failed > 0 ? ` · ${e.failed} failed` : ""}`}
              />
            );
          default:
            return null;
        }
      })}
      {running && <Line icon={<RefreshCwIcon />} status="running" title="Re-scoring" />}
    </Trace>
  );
}

/** The batch's saved assessments with their verdict change. */
export function RescoreResult({ part }: { part: ToolPart }) {
  const results = ((part.output ?? {}) as { results?: JobResult[] }).results ?? [];
  const saved = results.flatMap((r) => (r.status === "saved" ? [r] : []));
  if (saved.length === 0) return null;
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-3" aria-label="Re-scored jobs">
      <ul className="flex flex-col gap-2">
        {saved.map((r) => (
          <li key={r.draftId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <Link href={`/jobs/${r.jobId}`} className="font-medium hover:underline">
              {label(r)}
            </Link>
            <span className="inline-flex items-center gap-1">
              {isVerdict(r.before.verdict) && <VerdictBadge verdict={r.before.verdict} size="sm" />}
              <ArrowRightIcon className="size-3 text-muted-foreground" aria-label="now" />
              {isVerdict(r.after.verdict) && <VerdictBadge verdict={r.after.verdict} size="sm" />}
            </span>
            <FitMeter
              fitLevel={r.after.fitLevel as FitLevel | undefined}
              fitBasis={r.after.fitLevel ? "with_profile" : "role_only"}
            />
            <Badge variant="secondary">Saved · v{r.version}</Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}

const isVerdict = (v?: string): v is Recommendation =>
  RECOMMENDATIONS.includes(v as Recommendation);

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
