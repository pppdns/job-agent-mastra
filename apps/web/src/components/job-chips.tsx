import { BanknoteIcon } from "lucide-react";
import { TONE_FILL, TONES } from "@/components/assessment-visuals";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type Chip, MAX_SECONDARY } from "@/lib/job-chips";
import { cn } from "@/lib/utils";

/**
 * One chip: a button (so keyboard users can open the tooltip) above the row's covering link,
 * with the listing's words in the tooltip. Dashed = not confirmed; filled = worth attention.
 */
function ChipPill({ chip, compact }: { chip: Chip; compact?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-chip={chip.key}
          className={cn(
            "relative z-10 inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            compact ? "h-5 px-1.5 text-[11px]" : "px-2 py-0.5 text-xs",
            chip.filled
              ? cn(TONE_FILL[chip.tone], "border-transparent text-white")
              : TONES[chip.tone],
            chip.dashed && "border-dashed",
          )}
        >
          {chip.key === "pay" && <BanknoteIcon aria-hidden className="size-3" />}
          {chip.label}
          <span className="sr-only">. {chip.hint}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="flex max-w-xs flex-col gap-1">
        <span>{chip.hint}</span>
        {chip.quote && <span className="italic opacity-80">“{chip.quote}”</span>}
      </TooltipContent>
    </Tooltip>
  );
}

/** A job's chips: the always-there line (work mode, pay, level), then the extras ("+N"). */
export function JobChips({
  primary,
  secondary,
  compact,
  className,
}: {
  primary: Chip[];
  secondary: Chip[];
  compact?: boolean;
  className?: string;
}) {
  const shown = secondary.slice(0, MAX_SECONDARY);
  const rest = secondary.slice(MAX_SECONDARY);
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <ul aria-label="At a glance" className="flex flex-wrap items-center gap-1">
        {primary.map((chip) => (
          <li key={chip.key}>
            <ChipPill chip={chip} compact={compact} />
          </li>
        ))}
      </ul>
      {shown.length > 0 && (
        <ul aria-label="More facts" className="flex flex-wrap items-center gap-1">
          {shown.map((chip) => (
            <li key={chip.key}>
              <ChipPill chip={chip} compact={compact} />
            </li>
          ))}
          {rest.length > 0 && (
            <li>
              <ChipPill
                compact={compact}
                chip={{
                  key: "more",
                  label: `+${rest.length}`,
                  tone: "muted",
                  hint: rest.map((c) => c.label).join(", "),
                }}
              />
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Every chip with its quote, for the job page ("At a glance"). */
export function ChipEvidence({ chips }: { chips: Chip[] }) {
  const quoted = chips.filter((c) => c.quote);
  if (quoted.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
      {quoted.map((c) => (
        <li key={c.key}>
          <span className="font-medium text-foreground">{c.label}</span>: “{c.quote}”
        </li>
      ))}
    </ul>
  );
}
