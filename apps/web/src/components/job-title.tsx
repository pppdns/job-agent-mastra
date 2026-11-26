"use client";

import { MAX_JOB_TITLE_CHARS } from "@copilot/shared";
import { PencilIcon } from "lucide-react";
import { type FormEvent, useOptimistic, useRef, useState, useTransition } from "react";
import { setJobTitleAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveFailed } from "@/lib/app-update";

/**
 * The job's title as the page heading, renamed in place: the pencil (or a double-click) edits it,
 * Enter or leaving the field saves, Esc cancels. An empty or unchanged title saves nothing.
 */
export function JobTitle({ jobId, title }: { jobId: string; title: string | null }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useOptimistic(title);
  const [, startTransition] = useTransition();
  // Enter and the blur that follows must not save twice; Esc must not save at all.
  const done = useRef(false);

  const startEditing = () => {
    done.current = false;
    setDraft(shown ?? "");
    setError(null);
    setEditing(true);
  };

  const save = (event?: FormEvent) => {
    event?.preventDefault();
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const next = draft.replace(/\s+/g, " ").trim();
    if (!next || next === shown) return;
    startTransition(async () => {
      setShown(next);
      try {
        await setJobTitleAction(jobId, next);
      } catch (thrown) {
        saveFailed(thrown);
        setError("Couldn't rename the job. Try again.");
      }
    });
  };

  if (editing) {
    return (
      <form onSubmit={save} className="min-w-0 flex-1">
        <Input
          autoFocus
          aria-label="Job title"
          value={draft}
          maxLength={MAX_JOB_TITLE_CHARS}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => save()}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            done.current = true;
            setEditing(false);
          }}
          className="h-9 text-2xl font-semibold tracking-tight md:text-2xl"
        />
      </form>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="group flex items-start gap-1">
        <h1 className="text-2xl font-semibold tracking-tight" onDoubleClick={startEditing}>
          {shown ?? "Untitled job"}
        </h1>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Rename job"
          title="Rename job"
          onClick={startEditing}
          className="mt-0.5 shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <PencilIcon />
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
