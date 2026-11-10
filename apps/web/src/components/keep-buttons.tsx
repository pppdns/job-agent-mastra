"use client";

import { useState, useTransition } from "react";
import {
  assessJobAction,
  keepJobAction,
  keepPostingAction,
  resetStaleTriageAction,
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

/** Banner action: discovered jobs triaged against an older profile get triaged again. */
export function RetriageButton({ count }: { count: number }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm">
      <span className="text-muted-foreground">
        {count} discovered job{count === 1 ? " was" : "s were"} triaged against an older profile.
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => start(async () => void (await resetStaleTriageAction()))}
      >
        {pending ? "Clearing…" : "Re-triage on the next run"}
      </Button>
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
