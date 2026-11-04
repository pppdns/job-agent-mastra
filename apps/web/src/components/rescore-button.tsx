"use client";

import { RefreshCwIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { startRescoreAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

/** Starts a re-score batch in a new chat and opens it there. */
export function RescoreButton({ count }: { count: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-3 text-sm">
      <span>
        {count} {count === 1 ? "job was" : "jobs were"} assessed with an older profile.
      </span>
      <Button
        size="sm"
        className="ml-auto"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError((await startRescoreAction())?.error);
          })
        }
      >
        <RefreshCwIcon className={pending ? "animate-spin" : undefined} />
        Re-score {count > 25 ? "25" : count}
      </Button>
      <span className="w-full text-xs text-muted-foreground">
        One model call per job, at most 25 per batch. Each result becomes the job's current
        assessment.
      </span>
      {error && <p className="w-full text-destructive">{error}</p>}
    </div>
  );
}
