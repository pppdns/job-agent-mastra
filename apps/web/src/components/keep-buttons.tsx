"use client";

import { useState, useTransition } from "react";
import {
  assessJobAction,
  type DiscoveryActionState,
  keepJobAction,
  keepPostingAction,
  retriageNowAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";

/** "Keep anyway" on a hidden job or a dropped posting: it shows in the list from now on. */
export function KeepButton({ kind, id }: { kind: "job" | "posting"; id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      className="relative z-10 h-7"
      onClick={() => start(() => (kind === "job" ? keepJobAction(id) : keepPostingAction(id)))}
    >
      {pending ? "Keeping…" : "Keep anyway"}
    </Button>
  );
}

/**
 * Banner action: discovered jobs triaged against an older profile are triaged again now, in a
 * triage-only discovery run. Rendered always: hidden while nothing is stale, but its result line
 * stays after the count drops to zero.
 */
export function RetriageButton({ count }: { count: number }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<DiscoveryActionState>(null);
  if (count === 0 && !result) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm">
      {count > 0 && (
        <>
          <span className="text-muted-foreground">
            {count} discovered job{count === 1 ? " was" : "s were"} triaged against an older
            profile.
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => start(async () => setResult(await retriageNowAction()))}
          >
            {pending ? "Starting…" : "Re-triage now"}
          </Button>
          <span className="w-full text-xs text-muted-foreground">
            Fast model, about $0.002 a job. Progress is on the Discovery page.
          </span>
        </>
      )}
      {result && (
        <p
          role="status"
          className={result.ok ? "w-full text-muted-foreground" : "w-full text-destructive"}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}

/** "Assess fully" on a job with only a triage score: one assessment on the agent (~30 s). */
export function AssessButton({ jobId }: { jobId: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await assessJobAction(jobId);
            setMessage(result && { ok: result.ok, text: result.message });
          })
        }
      >
        {pending ? "Assessing… (about 30 s)" : "Assess fully"}
      </Button>
      {message && (
        <span
          role="status"
          className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}
        >
          {message.text}
        </span>
      )}
    </span>
  );
}
