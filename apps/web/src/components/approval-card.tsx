"use client";

import type { ApprovalView, DecisionError, ProfileChangePayload } from "@copilot/db";
import { assessmentSummary, PROFILE_FACT_LABELS } from "@copilot/shared";
import { CheckIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { decideApprovalAction } from "@/app/actions";
import { AssessmentView } from "@/components/assessment-view";
import { FitMeter, SignalChips, VerdictBadge } from "@/components/assessment-visuals";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemTitle,
} from "@/components/ui/item";

const ERRORS: Record<DecisionError | "invalid", string> = {
  not_found: "This proposal no longer exists.",
  wrong_thread: "This proposal belongs to another chat.",
  stale: "Things changed after this was proposed, so it no longer applies as shown.",
  superseded: "A newer proposal replaced this one.",
  already_resolved: "This proposal was already decided.",
  invalid: "The decision could not be sent.",
};

/**
 * Approval prompt for a proposed job snapshot or profile change. State comes from the
 * database, and the decision carries the hash of exactly the payload shown here.
 */
export function ApprovalCard({
  approvalId,
  threadId,
  initial,
}: {
  approvalId: string;
  threadId: string;
  /** Server-loaded view (profile page); the chat fetches it. */
  initial?: ApprovalView;
}) {
  const [view, setView] = useState<ApprovalView | null>(initial ?? null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (initial) return;
    let active = true;
    fetch(
      `/api/approvals/${encodeURIComponent(approvalId)}?threadId=${encodeURIComponent(threadId)}`,
    )
      .then((r) => (r.ok ? (r.json() as Promise<ApprovalView>) : null))
      .then((v) => {
        if (!active) return;
        if (v) setView(v);
        else setMissing(true);
      })
      .catch(() => active && setMissing(true));
    return () => {
      active = false;
    };
  }, [approvalId, threadId, initial]);

  if (missing) return <p className="text-sm text-muted-foreground">Proposal not available.</p>;
  if (!view) return <p className="text-sm text-muted-foreground">Loading proposal…</p>;

  const decide = (decision: "approve" | "reject") =>
    startTransition(async () => {
      setError(null);
      const result = await decideApprovalAction({
        approvalId,
        threadId,
        decision,
        payloadHash: view.payloadHash,
      });
      if (result.view) setView(result.view);
      if (result.error) setError(ERRORS[result.error]);
    });

  const isProfile = view.kind === "profile_change";
  return (
    <Item
      variant="outline"
      aria-label={isProfile ? "Profile change approval" : "Snapshot approval"}
    >
      <ItemContent>
        <ItemTitle>{isProfile ? "Update your profile?" : "Save approved snapshot?"}</ItemTitle>
        <ItemDescription>
          {view.kind === "profile_change"
            ? view.payload.reason
            : `${[view.payload.job.title, view.payload.job.company].filter(Boolean).join(" · ") || "Untitled job"} — draft v${view.draftVersion}`}
        </ItemDescription>
        {view.kind === "job_snapshot" && <SnapshotSignals view={view} />}
      </ItemContent>
      <ItemActions>
        {view.status === "pending" ? (
          <>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => decide("reject")}>
              Reject
            </Button>
            <Button size="sm" disabled={pending} onClick={() => decide("approve")}>
              Approve
            </Button>
          </>
        ) : (
          <StatusBadge view={view} />
        )}
      </ItemActions>
      {error && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {error}
        </p>
      )}
      <ItemFooter className="flex-col items-start gap-2">
        {view.kind === "profile_change" ? (
          <ProfileDiff payload={view.payload} />
        ) : (
          <>
            <Collapsible className="w-full">
              <CollapsibleTrigger asChild>
                <Button variant="link" size="sm" className="h-auto px-0">
                  Show the exact snapshot
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <AssessmentView assessment={view.payload.assessment} />
              </CollapsibleContent>
            </Collapsible>
            {view.jobId && (
              <Link
                href={`/jobs/${view.jobId}`}
                className="text-sm underline-offset-4 hover:underline"
              >
                Open job
              </Link>
            )}
          </>
        )}
      </ItemFooter>
    </Item>
  );
}

/** The exact change, line by line: what is added, what it replaces, what is removed. */
export function ProfileDiff({ payload }: { payload: ProfileChangePayload }) {
  return (
    <ul className="w-full space-y-1.5 text-sm" aria-label="Proposed profile changes">
      {payload.changes.map((change, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: changes have no id and never reorder
        <li key={i} className="flex flex-wrap items-baseline gap-x-2">
          {change.op === "add" && (
            <>
              <Badge variant="secondary">Add</Badge>
              <span>{change.text}</span>
              <span className="text-muted-foreground">{PROFILE_FACT_LABELS[change.kind]}</span>
            </>
          )}
          {change.op === "modify" && (
            <>
              <Badge variant="secondary">Change</Badge>
              <span className="text-muted-foreground line-through">{change.before.text}</span>
              <span>→ {change.text}</span>
              <span className="text-muted-foreground">{PROFILE_FACT_LABELS[change.kind]}</span>
            </>
          )}
          {change.op === "remove" && (
            <>
              <Badge variant="outline">Remove</Badge>
              <span className="line-through">{change.before.text}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function SnapshotSignals({ view }: { view: Extract<ApprovalView, { kind: "job_snapshot" }> }) {
  const summary = assessmentSummary(view.payload.assessment);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <VerdictBadge verdict={summary.verdict} size="sm" />
      <FitMeter fitLevel={summary.fitLevel} fitBasis={summary.fitBasis} />
      <SignalChips counts={summary.counts} />
    </div>
  );
}

function StatusBadge({ view }: { view: ApprovalView }) {
  switch (view.status) {
    case "approved":
      return (
        <Badge>
          <CheckIcon />
          {view.kind === "profile_change"
            ? `Approved · profile v${view.profileVersion}`
            : `Approved · v${view.snapshotVersion}`}
        </Badge>
      );
    case "rejected":
      return <Badge variant="secondary">Rejected</Badge>;
    case "stale":
      return <Badge variant="outline">Out of date</Badge>;
    case "superseded":
      return <Badge variant="outline">Replaced</Badge>;
    default:
      return null;
  }
}
