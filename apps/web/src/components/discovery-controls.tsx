"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { type DiscoveryActionState, startDiscoveryAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

/** "Run now" plus the occasional backfill; `maxBackfillUsd` is what a backfill may spend. */
export function DiscoveryControls({
  running,
  maxBackfillUsd,
}: {
  running: boolean;
  maxBackfillUsd: number | null;
}) {
  const [state, action, pending] = useActionState<DiscoveryActionState, FormData>(
    startDiscoveryAction,
    null,
  );
  const busy = running || pending;
  const cost = maxBackfillUsd === null ? "" : ` · up to $${maxBackfillUsd.toFixed(2)}`;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Button type="submit" name="lookbackDays" value="" disabled={busy}>
        {running ? "Running…" : "Run now"}
      </Button>
      <Button type="submit" name="lookbackDays" value="7" variant="outline" disabled={busy}>
        Backfill 7 days{cost}
      </Button>
      <Button type="submit" name="lookbackDays" value="30" variant="outline" disabled={busy}>
        Backfill 30 days{cost}
      </Button>
      {state && (
        <p
          role="status"
          className={state.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}
        >
          {state.message}
        </p>
      )}
    </form>
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
