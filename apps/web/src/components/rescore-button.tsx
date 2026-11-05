"use client";

import { MAX_RESCORE_JOBS as MAX_BATCH } from "@copilot/shared";
import { RefreshCwIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { startRescoreAction } from "@/app/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

const batch = (count: number) => Math.min(count, MAX_BATCH);

/** Starts a re-score batch in a new chat and opens it there. */
function useRescore() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const start = (scope: "stale" | "all") =>
    startTransition(async () => {
      setError((await startRescoreAction(scope))?.error);
    });
  return { pending, error, start };
}

/** Banner for jobs assessed against an older profile. */
export function RescoreButton({ count }: { count: number }) {
  const { pending, error, start } = useRescore();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-3 text-sm">
      <span>
        {count} {count === 1 ? "job was" : "jobs were"} assessed with an older profile.
      </span>
      <Button size="sm" className="ml-auto" disabled={pending} onClick={() => start("stale")}>
        <RefreshCwIcon className={pending ? "animate-spin" : undefined} />
        Re-score {batch(count)}
      </Button>
      <span className="w-full text-xs text-muted-foreground">
        One model call per job, at most {MAX_BATCH} per batch. Each result becomes the job's current
        assessment.
      </span>
      {error && <p className="w-full text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Re-scores every assessed active job (e.g. to fill in fields added later, like salary).
 * Costs one model call per job, so it asks first.
 */
export function RescoreAllButton({ count }: { count: number }) {
  const { pending, error, start } = useRescore();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={pending} className="sm:ml-auto">
          <RefreshCwIcon className={pending ? "animate-spin" : undefined} />
          Re-score all
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Re-score all active jobs?</AlertDialogTitle>
          <AlertDialogDescription>
            Re-assesses {batch(count)} of {count} assessed active {count === 1 ? "job" : "jobs"}{" "}
            against your current profile, one model call each. Stale and least recently updated jobs
            go first
            {count > MAX_BATCH && "; run it again for the rest"}. Earlier versions stay in each
            job's history.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => start("all")}>
            Re-score {batch(count)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </AlertDialog>
  );
}
