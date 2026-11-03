"use client";

import {
  type FitLevel,
  RECOMMENDATION_LABELS,
  RECOMMENDATIONS,
  type Recommendation,
} from "@copilot/shared";
import { ArrowRightIcon, CheckIcon, CircleAlertIcon, RefreshCwIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { approveDraftsAction, approvedDraftIdsAction } from "@/app/actions";
import { FitMeter, VerdictBadge } from "@/components/assessment-visuals";
import type { ToolPart } from "@/components/tool-trace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
                description={`${e.saved} new drafts${e.failed > 0 ? ` · ${e.failed} failed` : ""}`}
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

type Outcome = Awaited<ReturnType<typeof approveDraftsAction>>["results"];

const OUTCOME_TEXT: Record<string, string> = {
  approved: "Approved",
  changed: "Changed since: not approved",
  stale: "Changed since: not approved",
};

/** The batch's new drafts with their verdict change, and one button to approve exactly these. */
export function RescoreResult({ part, threadId }: { part: ToolPart; threadId: string }) {
  const results = ((part.output ?? {}) as { results?: JobResult[] }).results ?? [];
  const saved = results.flatMap((r) => (r.status === "saved" ? [r] : []));
  const draftIds = saved.map((r) => r.draftId);
  const draftIdsKey = draftIds.join(",");
  const [outcomes, setOutcomes] = useState<Outcome>();
  // Approvals made earlier (this card before a reload, a job page, another chat).
  const [approvedIds, setApprovedIds] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!draftIdsKey) return;
    let active = true;
    approvedDraftIdsAction(draftIdsKey.split(","))
      .then((ids) => active && setApprovedIds(ids))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [draftIdsKey]);
  if (saved.length === 0) return null;

  const outcomeOf = (draftId: string) =>
    outcomes?.find((o) => o.draftId === draftId)?.outcome ??
    (approvedIds.includes(draftId) ? "approved" : undefined);
  const allApproved = draftIds.every((id) => outcomeOf(id) === "approved");
  const approveAll = () =>
    startTransition(async () => {
      const response = await approveDraftsAction({
        threadId,
        // Drafts approved since (e.g. on a job page) are not sent again.
        draftIds: draftIds.filter((id) => outcomeOf(id) !== "approved"),
      });
      if (response.error) setError("Couldn't approve these drafts. Try again.");
      else setOutcomes(response.results);
    });

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-dashed p-3"
      aria-label="Re-scored jobs"
    >
      <ul className="flex flex-col gap-2">
        {saved.map((r) => {
          const outcome = outcomeOf(r.draftId);
          return (
            <li key={r.draftId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <Link href={`/jobs/${r.jobId}`} className="font-medium hover:underline">
                {label(r)}
              </Link>
              <span className="inline-flex items-center gap-1">
                {isVerdict(r.before.verdict) && (
                  <VerdictBadge verdict={r.before.verdict} size="sm" />
                )}
                <ArrowRightIcon className="size-3 text-muted-foreground" aria-label="now" />
                {isVerdict(r.after.verdict) && <VerdictBadge verdict={r.after.verdict} size="sm" />}
              </span>
              <FitMeter
                fitLevel={r.after.fitLevel as FitLevel | undefined}
                fitBasis={r.after.fitLevel ? "with_profile" : "role_only"}
              />
              {outcome ? (
                <Badge variant={outcome === "approved" ? "default" : "destructive"}>
                  {OUTCOME_TEXT[outcome] ?? "Not approved"}
                </Badge>
              ) : (
                <Badge variant="outline">Draft v{r.version} · not approved</Badge>
              )}
            </li>
          );
        })}
      </ul>
      {!outcomes && !allApproved && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={approveAll} disabled={pending}>
            <CheckIcon />
            Approve all {saved.length}
          </Button>
          <span className="text-xs text-muted-foreground">
            Approves exactly the drafts above. Open a job to review it first.
          </span>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
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
