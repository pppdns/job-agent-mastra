import { cn } from "cn";
import { TagIcon } from "lucide-react";

// The user's own labels: solid ink with square corners and a tag, so they stand out above the
// automatic chips (round, tone-colored) and never read as something the model decided.

/** Classes of one label; shared with the editor so both look the same. */
export function labelClassName(muted?: boolean) {
  return cn(
    "inline-flex h-5 max-w-full items-center gap-1 rounded-sm px-1.5 text-[11px] font-semibold whitespace-nowrap",
    muted ? "bg-muted-foreground/70 text-background" : "bg-foreground text-background",
  );
}

/** A job's labels on list rows, board cards and company pages; grey once the job is archived. */
export function JobLabels({
  labels,
  muted,
  className,
}: {
  labels: readonly string[] | null;
  muted?: boolean;
  className?: string;
}) {
  if (!labels?.length) return null;
  return (
    <ul aria-label="Your labels" className={cn("flex flex-wrap items-center gap-1", className)}>
      {labels.map((label) => (
        <li key={label} className={labelClassName(muted)}>
          <TagIcon aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{label}</span>
        </li>
      ))}
    </ul>
  );
}
