"use client";

import { PROFILE_FACT_KINDS, PROFILE_FACT_LABELS, type ProfileFactKind } from "@copilot/shared";
import { type FormEvent, useState, useTransition } from "react";
import { editProfileAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
      className="h-8 rounded-md border bg-transparent px-2 text-sm"
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
      <li className="flex flex-wrap items-center gap-2 text-sm">
        <span>{fact.text}</span>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => apply([{ op: "remove", factId: fact.id }], "Removed on the profile page")}
        >
          Remove
        </Button>
        {error && <span className="text-destructive">{error}</span>}
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
    <li>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <KindSelect value={kind} onChange={setKind} />
        <Input
          aria-label="Fact"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-8 flex-1"
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
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2" aria-label="Add a fact">
      <KindSelect value={kind} onChange={setKind} />
      <Input
        aria-label="New fact"
        placeholder="e.g. Remote within the EU only"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="h-8 flex-1"
      />
      <Button size="sm" type="submit" disabled={pending || !text.trim()}>
        Add
      </Button>
      {error && <p className="basis-full text-sm text-destructive">{error}</p>}
    </form>
  );
}
