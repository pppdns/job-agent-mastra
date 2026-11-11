"use client";

import { RESCORE_BATCH_SIZES, type RescoreLimit } from "@copilot/shared";
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

/** Jobs a batch of `limit` covers out of `count`. */
const covered = (limit: RescoreLimit, count: number) =>
  limit === "all" ? count : Math.min(limit, count);

/** Starts a re-score batch in a new chat and opens it there. */
function useRescore(count: number) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  // The smallest size by default: a known, low cost per click.
  const [limit, setLimit] = useState<RescoreLimit>(
    count > RESCORE_BATCH_SIZES[0] ? RESCORE_BATCH_SIZES[0] : "all",
  );
  const start = (scope: "stale" | "all") =>
    startTransition(async () => {
      setError((await startRescoreAction(scope, limit))?.error);
    });
  return { pending, error, limit, setLimit, start };
}

/** Batch size choice: the preset sizes below `count`, then all of them. */
function BatchSize({
  count,
  limit,
  onChange,
}: {
  count: number;
  limit: RescoreLimit;
  onChange: (limit: RescoreLimit) => void;
}) {
  const options: RescoreLimit[] = [...RESCORE_BATCH_SIZES.filter((s) => s < count), "all"];
  if (options.length === 1) return null;
  return (
    <fieldset className="flex flex-wrap items-center gap-1">
      <legend className="sr-only">Batch size</legend>
      <span className="mr-1 text-xs text-muted-foreground">Batch</span>
      {options.map((o) => (
        <Button
          key={o}
          type="button"
          size="xs"
          variant={o === limit ? "outline" : "ghost"}
          className={o === limit ? undefined : "text-muted-foreground"}
          aria-pressed={o === limit}
          onClick={() => onChange(o)}
        >
          {o === "all" ? `All ${count}` : o}
        </Button>
      ))}
    </fieldset>
  );
}

/** Banner for jobs assessed against an older profile. */
export function RescoreButton({ count }: { count: number }) {
  const { pending, error, limit, setLimit, start } = useRescore(count);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-3 text-sm">
      <span>
        {count} {count === 1 ? "job was" : "jobs were"} assessed with an older profile.
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <BatchSize count={count} limit={limit} onChange={setLimit} />
        <Button size="sm" disabled={pending} onClick={() => start("stale")}>
          <RefreshCwIcon className={pending ? "animate-spin" : undefined} />
          Re-score {covered(limit, count)}
        </Button>
      </div>
      <span className="w-full text-xs text-muted-foreground">
        One model call per job. Each result becomes the job's current assessment.
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
  const { pending, error, limit, setLimit, start } = useRescore(count);
  const n = covered(limit, count);
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
            Re-assesses {n} of {count} assessed active {count === 1 ? "job" : "jobs"} against your
            current profile, one model call each. Stale and least recently updated jobs go first
            {n < count && "; run it again for the rest"}. Earlier versions stay in each job's
            history.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <BatchSize count={count} limit={limit} onChange={setLimit} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => start("all")}>Re-score {n}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </AlertDialog>
  );
}
