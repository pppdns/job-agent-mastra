import { cn } from "cn";
import { AlertTriangleIcon, ClockIcon } from "lucide-react";
import { TONES } from "@/components/assessment-visuals";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Age, ProgressAge } from "@/lib/job-age";

/** The listing's age or time in stage (`jobAge` / `stageAge`), tinted by what it means. */
export function AgePill({
  age: { label, short, tone, tooltip, date },
  compact,
  className,
}: {
  age: Age;
  /** "~3w" instead of "Posted ~3w ago" (narrow screens). */
  compact?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A button so keyboard users can open the tooltip with the full dates. */}
        <button
          type="button"
          className={cn(
            "relative z-10 inline-flex items-center rounded-full border font-medium whitespace-nowrap tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            compact ? "h-4 px-1.5 text-[11px]" : "px-2 py-0.5 text-xs",
            TONES[tone],
            className,
          )}
        >
          <time dateTime={date.toISOString()}>{compact ? short : label}</time>
          <span className="sr-only">. {tooltip}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Time since a job last progressed (`progressAge`). Recent progress is plain grey text; only a
 * job that needs a follow-up (amber, clock) or looks stuck (red, alert) gets a colored chip.
 */
export function ProgressPill({
  age,
  long,
  className,
}: {
  age: ProgressAge;
  /** "Applied 9d ago" instead of "9d". */
  long?: boolean;
  className?: string;
}) {
  const Icon = age.attention === "stuck" ? AlertTriangleIcon : ClockIcon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative z-10 inline-flex h-5 items-center gap-1 rounded-full text-xs whitespace-nowrap tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            age.attention
              ? cn("border px-1.5 font-medium", TONES[age.tone])
              : "text-muted-foreground",
            className,
          )}
        >
          {age.attention && <Icon className="size-3" aria-hidden />}
          <time dateTime={age.date.toISOString()}>{long ? age.label : age.short}</time>
          <span className="sr-only">. {age.tooltip}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{age.tooltip}</TooltipContent>
    </Tooltip>
  );
}
