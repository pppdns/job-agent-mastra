import type { JobLabel } from "@copilot/shared";
import { cn } from "cn";
import { StarIcon, TagIcon } from "lucide-react";

// The user's own labels: solid fills with square corners, so they stand out above the automatic
// chips (round, tone-colored) and never read as something the model decided. Important ones
// (solid red, star) are the user's top priority and come first.

/** Classes of one label; shared with the editor so both look the same. */
export function labelClassName(important: boolean, muted?: boolean) {
  return cn(
    "inline-flex h-5 max-w-full items-center gap-1 rounded-sm px-1.5 text-[11px] font-semibold whitespace-nowrap",
    important
      ? muted
        ? "bg-destructive/50 text-white"
        : "bg-destructive text-white"
      : muted
        ? "bg-muted-foreground/70 text-background"
        : "bg-foreground text-background",
  );
}

/** Icon of one label: a filled star when important, else a tag. */
export function LabelIcon({ important }: { important: boolean }) {
  return important ? (
    <StarIcon aria-hidden className="size-3 shrink-0 fill-current" />
  ) : (
    <TagIcon aria-hidden className="size-3 shrink-0" />
  );
}

/** A job's labels on rows, cards and the job page; grey once the job is archived. */
export function JobLabels({
  labels,
  muted,
  className,
}: {
  labels: readonly JobLabel[] | null;
  muted?: boolean;
  className?: string;
}) {
  if (!labels?.length) return null;
  return (
    <ul aria-label="Your labels" className={cn("flex flex-wrap items-center gap-1", className)}>
      {labels.map((label) => (
        <li
          key={label.text}
          title={label.text}
          data-important={label.important || undefined}
          className={labelClassName(label.important, muted)}
        >
          <LabelIcon important={label.important} />
          <span className="truncate">{label.text}</span>
          {label.important && <span className="sr-only"> (important)</span>}
        </li>
      ))}
    </ul>
  );
}
