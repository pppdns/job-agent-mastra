"use client";

import type { ApprovalView, DecisionError } from "@copilot/db";
import { RECOMMENDATION_LABELS } from "@copilot/shared";
import { CheckIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { decideSnapshot } from "@/app/actions";
import { AssessmentView } from "@/components/assessment-view";
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
  stale: "The draft changed after this was proposed. Ask for a new proposal.",
  superseded: "A newer proposal replaced this one.",
  already_resolved: "This proposal was already decided.",
  invalid: "The decision could not be sent.",
};

/**
 * Approval prompt for a proposed job snapshot. State comes from the database, and the
 * decision carries the hash of exactly the payload shown here.
 */
export function ApprovalCard({ approvalId, threadId }: { approvalId: string; threadId: string }) {
  const [view, setView] = useState<ApprovalView | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
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
  }, [approvalId, threadId]);

  if (missing) return <p className="text-sm text-muted-foreground">Proposal not available.</p>;
  if (!view) return <p className="text-sm text-muted-foreground">Loading proposal…</p>;

  const { job, assessment } = view.payload;
  const decide = (decision: "approve" | "reject") =>
    startTransition(async () => {
      setError(null);
      const result = await decideSnapshot({
        approvalId,
        threadId,
        decision,
        payloadHash: view.payloadHash,
      });
      if (result.view) setView(result.view);
      if (result.error) setError(ERRORS[result.error]);
    });

  return (
    <Item variant="outline" aria-label="Snapshot approval">
      <ItemContent>
        <ItemTitle>Save approved snapshot?</ItemTitle>
        <ItemDescription>
          {[job.title, job.company].filter(Boolean).join(" · ") || "Untitled job"} — draft v
          {view.draftVersion}. Recommendation:{" "}
          {RECOMMENDATION_LABELS[assessment.recommendation.verdict]}.
        </ItemDescription>
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
        <Collapsible className="w-full">
          <CollapsibleTrigger asChild>
            <Button variant="link" size="sm" className="h-auto px-0">
              Show the exact snapshot
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <AssessmentView assessment={assessment} />
          </CollapsibleContent>
        </Collapsible>
        {view.jobId && (
          <Link href={`/jobs/${view.jobId}`} className="text-sm underline-offset-4 hover:underline">
            Open job
          </Link>
        )}
      </ItemFooter>
    </Item>
  );
}

function StatusBadge({ view }: { view: ApprovalView }) {
  switch (view.status) {
    case "approved":
      return (
        <Badge>
          <CheckIcon />
          Approved · v{view.snapshotVersion}
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
