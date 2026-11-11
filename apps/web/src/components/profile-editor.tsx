"use client";

import { PROFILE_FACT_KINDS, PROFILE_FACT_LABELS, type ProfileFactKind } from "@copilot/shared";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, useState, useTransition } from "react";
import { editProfileAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROFILE_KIND_UI } from "@/lib/profile-kinds";
import { cn } from "@/lib/utils";

type Fact = { id: string; kind: ProfileFactKind; text: string };

/** Applies an edit right away; `version` is the profile version the page shows. */
function useEdit(version: number) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const apply = (changes: unknown[], reason: string, done?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await editProfileAction({ changes, reason }, version);
      if (result.error) setError(result.error);
      else done?.();
    });
  return { error, pending, apply };
}

function KindSelect({
  value,
  onChange,
}: {
  value: ProfileFactKind;
  onChange: (k: ProfileFactKind) => void;
}) {
  return (
    <select
      aria-label="Kind"
      value={value}
      onChange={(e) => onChange(e.target.value as ProfileFactKind)}
      className="h-8 rounded-md border bg-background px-2 text-sm"
    >
      {PROFILE_FACT_KINDS.map((k) => (
        <option key={k} value={k}>
          {PROFILE_FACT_LABELS[k]}
        </option>
      ))}
    </select>
  );
}

/** A current fact with edit/remove, both applied right away. */
export function FactRow({ fact, version }: { fact: Fact; version: number }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.text);
  const [kind, setKind] = useState(fact.kind);
  const { error, pending, apply } = useEdit(version);

  if (!editing) {
    return (
      <li
        className={cn(
          "group flex items-start gap-3 rounded-md px-2 py-1 hover:bg-muted/50",
          pending && "opacity-50",
        )}
      >
        <span
          aria-hidden
          className={cn("mt-2 size-1.5 shrink-0 rounded-full", PROFILE_KIND_UI[fact.kind].dot)}
        />
        <span className="flex-1 text-sm leading-6">{fact.text}</span>
        {/* Always visible on touch screens; on hover or focus from sm up. */}
        <span className="flex shrink-0 gap-0.5 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Edit"
            className="text-muted-foreground"
            onClick={() => setEditing(true)}
          >
            <PencilIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Remove"
            className="text-muted-foreground hover:text-destructive"
            disabled={pending}
            onClick={() =>
              apply([{ op: "remove", factId: fact.id }], "Removed on the profile page")
            }
          >
            <Trash2Icon />
          </Button>
        </span>
        {error && <span className="basis-full text-sm text-destructive">{error}</span>}
      </li>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    apply([{ op: "modify", factId: fact.id, kind, text }], "Edited on the profile page", () =>
      setEditing(false),
    );
  };
  return (
    <li className="rounded-md bg-muted/50 p-2">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <KindSelect value={kind} onChange={setKind} />
        <Input
          aria-label="Fact"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-8 min-w-48 flex-1 bg-background"
          autoFocus
        />
        <Button size="sm" type="submit" disabled={pending}>
          Save
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        {error && <p className="basis-full text-sm text-destructive">{error}</p>}
      </form>
    </li>
  );
}

export function AddFactForm({ version }: { version: number }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<ProfileFactKind>("soft_preference");
  const { error, pending, apply } = useEdit(version);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    apply([{ op: "add", kind, text }], "Added on the profile page", () => setText(""));
  };
  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-3"
      aria-label="Add a fact"
    >
      <KindSelect value={kind} onChange={setKind} />
      <Input
        aria-label="New fact"
        placeholder={PROFILE_KIND_UI[kind].placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="h-8 min-w-48 flex-1"
      />
      <Button size="sm" type="submit" disabled={pending || !text.trim()}>
        <PlusIcon data-icon="inline-start" />
        Add
      </Button>
      {error && <p className="basis-full text-sm text-destructive">{error}</p>}
    </form>
  );
}
