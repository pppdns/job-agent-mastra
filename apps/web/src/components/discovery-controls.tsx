"use client";

import { ASSESS_BATCH_SIZES } from "@copilot/shared";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import {
  type DiscoveryActionState,
  startDiscoveryAction,
  stopDiscoveryAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";

/**
 * "Run now", the occasional backfill, and runs that skip fetching: triage the next batch of
 * waiting jobs, or fully assess more matches (a batch size picked here). "Stop run" while one
 * is going. `maxBackfillUsd` is what a backfill may spend.
 */
export function DiscoveryControls({
  running,
  maxBackfillUsd,
  awaitingTriage,
}: {
  running: boolean;
  maxBackfillUsd: number | null;
  awaitingTriage: number;
}) {
  // The smallest batch by default: a known, low cost per click.
  const [assessLimit, setAssessLimit] = useState<number>(ASSESS_BATCH_SIZES[0]);
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
        <span className="flex flex-wrap items-center gap-1">
          <input type="hidden" name="assessLimit" value={assessLimit} />
          <Button type="submit" name="run" value="assess" variant="outline" disabled={busy}>
            Assess more matches · up to {assessLimit}
          </Button>
          <fieldset className="flex items-center gap-1">
            <legend className="sr-only">Assessment batch size</legend>
            {ASSESS_BATCH_SIZES.map((n) => (
              <Button
                key={n}
                type="button"
                size="xs"
                variant={n === assessLimit ? "outline" : "ghost"}
                className={n === assessLimit ? undefined : "text-muted-foreground"}
                aria-pressed={n === assessLimit}
                onClick={() => setAssessLimit(n)}
              >
                {n}
              </Button>
            ))}
          </fieldset>
        </span>
      </form>
      <p className="text-xs text-muted-foreground">
        Assessing uses the main model, about $0.04 a job, best matches first. A bigger batch raises
        that run&apos;s spend cap to fit.
      </p>
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
