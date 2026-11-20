"use client";

import { MAX_JOB_LABELS, normalizeJobLabels, normalizeLabel } from "@copilot/shared";
import { cn } from "cn";
import { PlusIcon, TagIcon, XIcon } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { setJobLabelsAction } from "@/app/actions";
import { labelClassName } from "@/components/job-labels";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * A job's labels with optimistic saving: each change is saved at once, and a second change before
 * the refresh lands builds on the first.
 */
export function useJobLabels(jobId: string, labels: readonly string[] | null) {
  const [, start] = useTransition();
  const [current, setCurrent] = useOptimistic<string[]>(labels ? [...labels] : []);
  const save = (next: string[]) =>
    start(async () => {
      const normalized = normalizeJobLabels(next);
      setCurrent(normalized);
      await setJobLabelsAction(jobId, normalized);
    });
  return [current, save] as const;
}

/**
 * Search box over the labels already in use: picking one toggles it on the job, and typing a new
 * one offers "Create". Known labels come most used first.
 */
export function LabelsPicker({
  labels,
  knownLabels,
  onChange,
}: {
  labels: readonly string[];
  knownLabels: readonly string[];
  onChange: (labels: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const typed = normalizeLabel(search);
  const has = (label: string) => labels.some((l) => l.toLowerCase() === label.toLowerCase());
  const options = [...labels, ...knownLabels.filter((l) => !has(l))];
  const full = labels.length >= MAX_JOB_LABELS;
  const isNew = typed !== "" && !options.some((l) => l.toLowerCase() === typed.toLowerCase());
  const toggle = (label: string) =>
    onChange(
      has(label)
        ? labels.filter((l) => l.toLowerCase() !== label.toLowerCase())
        : [...labels, label],
    );
  return (
    <Command>
      <CommandInput
        placeholder="Find or create a label"
        value={search}
        onValueChange={setSearch}
        maxLength={64}
      />
      <CommandList>
        <CommandEmpty>Type a label to create it.</CommandEmpty>
        <CommandGroup>
          {options.map((label) => (
            <CommandItem
              key={label}
              value={label}
              data-checked={has(label)}
              disabled={full && !has(label)}
              onSelect={() => toggle(label)}
            >
              <TagIcon className="size-3.5 text-muted-foreground" />
              <span className="truncate">{label}</span>
            </CommandItem>
          ))}
          {isNew && (
            <CommandItem
              forceMount
              value={`create:${typed}`}
              disabled={full}
              onSelect={() => {
                toggle(typed);
                setSearch("");
              }}
            >
              <PlusIcon className="size-3.5" />
              <span className="truncate">Create “{typed}”</span>
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
      {full && (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          At most {MAX_JOB_LABELS} labels per job.
        </p>
      )}
    </Command>
  );
}

/** The job page's labels: each removable, plus a button that opens the picker. */
export function JobLabelsField({
  jobId,
  labels,
  knownLabels,
  muted,
}: {
  jobId: string;
  labels: readonly string[] | null;
  knownLabels: readonly string[];
  muted?: boolean;
}) {
  const [current, save] = useJobLabels(jobId, labels);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {current.length > 0 && (
        <ul aria-label="Your labels" className="contents">
          {current.map((label) => (
            <li key={label} className={cn(labelClassName(muted), "pr-0.5")}>
              <TagIcon aria-hidden className="size-3 shrink-0" />
              <span className="truncate">{label}</span>
              <button
                type="button"
                aria-label={`Remove label ${label}`}
                className="rounded-sm p-0.5 opacity-70 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={() => save(current.filter((l) => l !== label))}
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-5 gap-1 px-1.5 text-[11px]">
            <PlusIcon className="size-3" />
            {current.length > 0 ? "Label" : "Add label"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0">
          <LabelsPicker labels={current} knownLabels={knownLabels} onChange={save} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
