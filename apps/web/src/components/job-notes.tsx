"use client";

import { MAX_JOB_NOTES_CHARS } from "@copilot/shared";
import { NotebookTextIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { setJobNotesAction } from "@/app/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

/**
 * The user's free-text note on a job. Read-only until "Edit"; Save (or ⌘/Ctrl+Enter) writes it,
 * Cancel (or Esc) asks before dropping unsaved text, and leaving the page while editing warns.
 * A note saved elsewhere since the page loaded is never overwritten.
 */
export function JobNotes({
  jobId,
  notes,
  updatedAtMs,
  editedLabel,
}: {
  jobId: string;
  notes: string | null;
  /** Save time of `notes`, the conflict token. */
  updatedAtMs: number | null;
  /** "Edited 12 Nov 2026", formatted on the server. */
  editedLabel: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [conflict, setConflict] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [pending, startTransition] = useTransition();
  const field = useRef<HTMLTextAreaElement>(null);
  const dirty = editing && draft.trim() !== (notes ?? "");
  const tooLong = draft.trim().length > MAX_JOB_NOTES_CHARS;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const startEditing = () => {
    setDraft(notes ?? "");
    setConflict(false);
    setEditing(true);
    // Caret at the end, where notes usually grow.
    requestAnimationFrame(() => {
      const el = field.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const stopEditing = () => {
    setEditing(false);
    setConfirmDiscard(false);
    setConflict(false);
  };

  const cancel = () => (dirty ? setConfirmDiscard(true) : stopEditing());

  const save = () => {
    if (pending || tooLong) return;
    if (!dirty) return stopEditing();
    startTransition(async () => {
      const result = await setJobNotesAction(jobId, draft, updatedAtMs);
      if (result.status === "conflict") setConflict(true);
      else stopEditing();
    });
  };

  if (!editing && !notes) {
    return (
      <Button variant="outline" size="sm" className="self-start" onClick={startEditing}>
        <PlusIcon />
        Add a note
      </Button>
    );
  }

  return (
    <Card role="region" aria-label="Notes" size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <NotebookTextIcon className="size-4 text-muted-foreground" />
          Notes
          {!editing && editedLabel && (
            <span className="text-xs font-normal text-muted-foreground">{editedLabel}</span>
          )}
        </CardTitle>
        {!editing && (
          <CardAction>
            <Button variant="ghost" size="sm" onClick={startEditing}>
              <PencilIcon />
              Edit
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <Textarea
              ref={field}
              aria-label="Note"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  save();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  cancel();
                }
              }}
              placeholder="Interview rounds, people, impressions, next steps…"
              aria-invalid={tooLong || undefined}
              className="max-h-[60vh] min-h-40"
              disabled={pending}
            />
            {conflict && (
              <p role="alert" className="text-sm text-destructive">
                This note was changed elsewhere since you opened the page. Copy your text, then
                reload to see the latest version.
              </p>
            )}
            {tooLong && (
              <p role="alert" className="text-sm text-destructive">
                Too long: {draft.trim().length.toLocaleString("en-GB")} of{" "}
                {MAX_JOB_NOTES_CHARS.toLocaleString("en-GB")} characters.
              </p>
            )}
            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground sm:inline">
                ⌘/Ctrl+Enter to save · Esc to cancel
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={cancel}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending || tooLong || conflict}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm break-words whitespace-pre-wrap">{notes}</p>
        )}
      </CardContent>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // Back to the text after "Keep editing" (the dialog would focus Cancel).
            event.preventDefault();
            field.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              The note goes back to its last saved version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={stopEditing}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
