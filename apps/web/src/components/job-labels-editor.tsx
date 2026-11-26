"use client";

import {
  type JobLabel,
  MAX_JOB_LABELS,
  MAX_LABEL_LENGTH,
  normalizeJobLabels,
  normalizeLabelText,
} from "@copilot/shared";
import { cn } from "cn";
import { PlusIcon, StarIcon, XIcon } from "lucide-react";
import { useId, useOptimistic, useState, useTransition } from "react";
import { setJobLabelsAction } from "@/app/actions";
import { JobLabels } from "@/components/job-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * A job's labels with optimistic saving: each change is saved at once, and a second change before
 * the refresh lands builds on the first.
 */
export function useJobLabels(jobId: string, labels: readonly JobLabel[] | null) {
  const [, start] = useTransition();
  const [current, setCurrent] = useOptimistic<JobLabel[]>(labels ? [...labels] : []);
  const save = (next: JobLabel[]) =>
    start(async () => {
      const normalized = normalizeJobLabels(next);
      setCurrent(normalized);
      await setJobLabelsAction(jobId, normalized);
    });
  return [current, save] as const;
}

/** Star toggle: marks a label (or the one being added) as important. */
function StarToggle({
  on,
  onClick,
  label,
  className,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn("size-7 shrink-0", on && "text-destructive hover:text-destructive", className)}
    >
      <StarIcon className={cn("size-4", on && "fill-current")} />
    </Button>
  );
}

/**
 * A field to add a label (focused on open; Enter adds; the star beside it marks the new label
 * important), then the job's labels, each with a star (important) and a delete button. A label
 * already on the job (any case) or a full job gets a short notice instead of a silent no-op.
 */
export function LabelsEditor({
  labels,
  onChange,
}: {
  labels: readonly JobLabel[];
  onChange: (labels: JobLabel[]) => void;
}) {
  const [text, setText] = useState("");
  const [important, setImportant] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeId = useId();
  const full = labels.length >= MAX_JOB_LABELS;
  const add = () => {
    const clean = normalizeLabelText(text);
    if (!clean) return;
    const existing = labels.find((l) => l.text.toLowerCase() === clean.toLowerCase());
    if (existing) {
      // Same label in another case: say so instead of silently merging into it.
      if (important && !existing.important) {
        onChange(labels.map((l) => (l === existing ? { ...l, important: true } : l)));
        setNotice(`Marked “${existing.text}” important`);
      } else {
        setNotice(`“${existing.text}” is already on this job`);
        return;
      }
    } else if (full) {
      setNotice(`At most ${MAX_JOB_LABELS} labels: delete one first`);
      return;
    } else {
      onChange([...labels, { text: clean, important }]);
      setNotice(null);
    }
    setText("");
    setImportant(false);
  };
  return (
    <div className="flex flex-col gap-2">
      {/* The field stays enabled even when full, so it always takes the focus on open. */}
      <form
        className="flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <Input
          aria-label="New label"
          aria-describedby={notice ? noticeId : undefined}
          placeholder="New label"
          value={text}
          maxLength={MAX_LABEL_LENGTH}
          onChange={(event) => {
            setText(event.target.value);
            setNotice(null);
          }}
          className="h-7 text-sm"
        />
        <StarToggle on={important} label="Important" onClick={() => setImportant(!important)} />
        <Button type="submit" size="sm" className="h-7" disabled={!text.trim()}>
          Add
        </Button>
      </form>
      {notice && (
        <p id={noticeId} role="status" className="px-1 text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      {labels.length > 0 && (
        <ul aria-label="Labels on this job" className="flex flex-col gap-0.5">
          {labels.map((label) => (
            <li key={label.text} className="flex items-center gap-1">
              <StarToggle
                on={label.important}
                label={`Important: ${label.text}`}
                onClick={() =>
                  onChange(
                    labels.map((l) =>
                      l.text === label.text ? { ...l, important: !l.important } : l,
                    ),
                  )
                }
              />
              <span className="min-w-0 flex-1 truncate text-sm" title={label.text}>
                {label.text}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Delete label ${label.text}`}
                title="Delete"
                className="size-7 shrink-0 text-muted-foreground"
                onClick={() => onChange(labels.filter((l) => l.text !== label.text))}
              >
                <XIcon className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The editor for one job, with its own optimistic state; mounted only while a popover is open. */
export function JobLabelsEditor({
  jobId,
  labels,
}: {
  jobId: string;
  labels: readonly JobLabel[] | null;
}) {
  const [current, save] = useJobLabels(jobId, labels);
  return <LabelsEditor labels={current} onChange={save} />;
}

/** The job page's labels, with a button that opens the editor. */
export function JobLabelsField({
  jobId,
  labels,
  muted,
}: {
  jobId: string;
  labels: readonly JobLabel[] | null;
  muted?: boolean;
}) {
  const [current, save] = useJobLabels(jobId, labels);
  return (
    <div className="flex flex-wrap items-center gap-1">
      <JobLabels labels={current} muted={muted} />
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-5 gap-1 px-1.5 text-[11px]">
            <PlusIcon className="size-3" />
            {current.length > 0 ? "Labels" : "Add label"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <LabelsEditor labels={current} onChange={save} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
