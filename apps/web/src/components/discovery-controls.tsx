"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import {
  type DiscoveryActionState,
  startDiscoveryAction,
  stopDiscoveryAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";

/**
 * "Run now", the occasional backfill, and runs that skip fetching: triage the next batch of
 * waiting jobs, or fully assess more matches. "Stop run" while one is going.
 * `maxBackfillUsd` is what a backfill may spend.
 */
export function DiscoveryControls({
  running,
  maxBackfillUsd,
  awaitingTriage,
  maxAssessments,
}: {
  running: boolean;
  maxBackfillUsd: number | null;
  awaitingTriage: number;
  maxAssessments: number;
}) {
  // One action for every button, so the feedback line always shows the latest result.
  const [shown, action, pending] = useActionState<DiscoveryActionState, FormData>(
    (prev, formData) =>
      formData.get("run") === "stop" ? stopDiscoveryAction() : startDiscoveryAction(prev, formData),
    null,
  );
  const busy = running || pending;
  const cost = maxBackfillUsd === null ? "" : ` · up to $${maxBackfillUsd.toFixed(2)}`;
  return (
    <div className="flex flex-col gap-2">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <Button type="submit" name="run" value="now" disabled={busy}>
          {running ? "Running…" : "Run now"}
        </Button>
        <Button type="submit" name="run" value="backfill-7" variant="outline" disabled={busy}>
          Backfill 7 days{cost}
        </Button>
        <Button type="submit" name="run" value="backfill-30" variant="outline" disabled={busy}>
          Backfill 30 days{cost}
        </Button>
        <Button
          type="submit"
          name="run"
          value="triage"
          variant="outline"
          disabled={busy || awaitingTriage === 0}
        >
          Triage next batch · {awaitingTriage.toLocaleString("en-US")} waiting
        </Button>
        <Button
          type="submit"
          name="run"
          value="assess"
          variant="outline"
          disabled={busy || maxAssessments === 0}
        >
          Assess more matches · up to {maxAssessments}
        </Button>
      </form>
      {running && (
        <form action={action}>
          <Button
            type="submit"
            name="run"
            value="stop"
            variant="destructive"
            size="sm"
            disabled={pending}
          >
            {pending ? "Stopping…" : "Stop run"}
          </Button>
        </form>
      )}
      {shown && (
        <p
          role="status"
          className={shown.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}
        >
          {shown.message}
        </p>
      )}
    </div>
  );
}

/** Refreshes the page every few seconds while a run is going, so results appear as they land. */
export function RefreshWhileRunning({ running }: { running: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 3_000);
    return () => clearInterval(timer);
  }, [running, router]);
  return null;
}
