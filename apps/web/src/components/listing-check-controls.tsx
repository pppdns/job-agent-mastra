"use client";

import type { ListingScope } from "@copilot/db";
import { useActionState, useState } from "react";
import { type DiscoveryActionState, startListingCheckAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { LISTING_SCOPE_LABELS } from "@/lib/listing-scopes";

/** Requests are spaced 1.5 s apart on LinkedIn, 0.5 s elsewhere; most jobs have a LinkedIn link. */
const SECONDS_PER_JOB = 2;
/** The run's cap (jobsToCheckListings' default limit): least recently checked first. */
const MAX_JOBS = 500;

/**
 * "Check now": pick which jobs to re-check (counts per group, already archived or once-closed
 * jobs excluded) and start the check-listings workflow. The daily run checks `dailyScopes`.
 */
export function ListingCheckControls({
  counts,
  dailyScopes,
  running,
  digestThreshold,
}: {
  counts: Record<ListingScope, number>;
  dailyScopes: readonly ListingScope[];
  running: boolean;
  digestThreshold: number;
}) {
  const [picked, setPicked] = useState<Set<ListingScope>>(() => new Set(dailyScopes));
  const [shown, action, pending] = useActionState(
    startListingCheckAction,
    null as DiscoveryActionState,
  );
  const total = [...picked].reduce((sum, s) => sum + counts[s], 0);
  const jobs = Math.min(total, MAX_JOBS);
  const minutes = Math.max(1, Math.round((jobs * SECONDS_PER_JOB) / 60));
  const scopes = Object.keys(LISTING_SCOPE_LABELS) as ListingScope[];
  return (
    <form action={action} className="flex flex-col gap-2">
      <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <legend className="sr-only">Jobs to check</legend>
        {scopes.map((scope) => (
          <label key={scope} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              name="scope"
              value={scope}
              className="size-4 accent-primary"
              checked={picked.has(scope)}
              onChange={(e) => {
                const next = new Set(picked);
                if (e.target.checked) next.add(scope);
                else next.delete(scope);
                setPicked(next);
              }}
            />
            {LISTING_SCOPE_LABELS[scope]}
            <span className="text-muted-foreground tabular-nums">
              {counts[scope].toLocaleString("en-US")}
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-muted-foreground">
        Top matches: new jobs scored at least {digestThreshold} (the digest threshold) or added from
        a chat. Other matches: the rest of the new jobs you see in Jobs.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          variant="outline"
          disabled={running || pending || picked.size === 0 || total === 0}
        >
          {running ? "Checking…" : `Check now · ${jobs.toLocaleString("en-US")} jobs`}
        </Button>
        <span className="text-xs text-muted-foreground">
          {total > MAX_JOBS
            ? `${total.toLocaleString("en-US")} picked; one run checks the ${MAX_JOBS} least recently checked. `
            : ""}
          {jobs > 0 && !running ? `About ${minutes} min. ` : ""}
          Free (plain page requests, no model).
        </span>
      </div>
      {shown && (
        <p
          role="status"
          className={shown.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}
        >
          {shown.message}
        </p>
      )}
    </form>
  );
}
