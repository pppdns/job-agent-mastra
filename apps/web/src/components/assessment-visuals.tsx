import {
  type AssessmentSummary,
  EVIDENCE_LABELS,
  type EvidenceClass,
  FIT_LEVEL_LABELS,
  FIT_LEVELS,
  type FitLevel,
  RECOMMENDATION_LABELS,
  type Recommendation,
} from "@copilot/shared";
import { cn } from "cn";
import {
  BadgeCheckIcon,
  BanknoteIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  LightbulbIcon,
  type LucideIcon,
  OctagonXIcon,
  RocketIcon,
  ScaleIcon,
  SearchIcon,
  ShieldCheckIcon,
  ShieldQuestionIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TriangleAlertIcon,
  VenetianMaskIcon,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Text, tinted background and border for one signal color. */
export const TONES = {
  success: "text-success bg-success/10 border-success/30",
  info: "text-info bg-info/10 border-info/30",
  warning: "text-warning bg-warning/10 border-warning/30",
  destructive: "text-destructive bg-destructive/10 border-destructive/30",
  muted: "text-muted-foreground bg-muted border-border",
} as const;
export type Tone = keyof typeof TONES;

/** Solid accent (stripes, meter segments) per tone. */
export const TONE_FILL: Record<Tone, string> = {
  success: "bg-success",
  info: "bg-info",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground/40",
};

export const VERDICT: Record<Recommendation, { tone: Tone; icon: LucideIcon }> = {
  pursue: { tone: "success", icon: RocketIcon },
  consider: { tone: "info", icon: ThumbsUpIcon },
  investigate_further: { tone: "warning", icon: SearchIcon },
  pass: { tone: "destructive", icon: ThumbsDownIcon },
  undecided: { tone: "muted", icon: CircleHelpIcon },
};

export const FIT_TONE: Record<FitLevel, Tone> = {
  strong: "success",
  good: "success",
  mixed: "warning",
  weak: "destructive",
  poor: "destructive",
};

export const SIGNALS = {
  hardConflicts: { label: "Hard conflicts", tone: "destructive", icon: OctagonXIcon },
  weaknesses: { label: "Weaknesses", tone: "warning", icon: TriangleAlertIcon },
  softTradeoffs: { label: "Tradeoffs", tone: "info", icon: ScaleIcon },
  strengths: { label: "Strengths", tone: "success", icon: CircleCheckIcon },
  unknowns: { label: "Unknowns", tone: "muted", icon: CircleHelpIcon },
} as const satisfies Record<
  keyof AssessmentSummary["counts"],
  { label: string; tone: Tone; icon: LucideIcon }
>;

const EVIDENCE: Record<EvidenceClass, { tone: Tone; icon: LucideIcon }> = {
  official: { tone: "info", icon: BadgeCheckIcon },
  independent: { tone: "success", icon: ShieldCheckIcon },
  anonymous: { tone: "warning", icon: VenetianMaskIcon },
  inference: { tone: "muted", icon: LightbulbIcon },
  unknown_conflicting: { tone: "destructive", icon: ShieldQuestionIcon },
};

export function VerdictBadge({
  verdict,
  size = "md",
}: {
  verdict: Recommendation;
  size?: "sm" | "md";
}) {
  const { tone, icon: Icon } = VERDICT[verdict];
  return (
    <span
      data-verdict={verdict}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        size === "md" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs",
        TONES[tone],
      )}
    >
      <Icon className={size === "md" ? "size-4" : "size-3"} />
      {RECOMMENDATION_LABELS[verdict]}
    </span>
  );
}

/** A verdict as a quiet, uncolored icon (label on hover), for places where fit carries the color. */
export function VerdictIcon({
  verdict,
  className,
}: {
  verdict: Recommendation;
  className?: string;
}) {
  const Icon = VERDICT[verdict].icon;
  const label = RECOMMENDATION_LABELS[verdict];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A button so keyboard users can open the tooltip with the verdict's label. */}
        <button
          type="button"
          data-verdict={verdict}
          className={cn(
            "inline-flex shrink-0 rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            className,
          )}
        >
          <Icon aria-hidden className="size-3.5" />
          <span className="sr-only">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Five segments, filled from the left; dashed and empty when fit wasn't judged. */
export function FitMeter({
  fitLevel,
  fitBasis,
  labelClassName,
  muted,
}: Pick<AssessmentSummary, "fitLevel" | "fitBasis"> & {
  /** e.g. `max-sm:sr-only` to show only the meter on narrow screens. */
  labelClassName?: string;
  /** Grey instead of the fit color, once fit no longer drives a decision. */
  muted?: boolean;
}) {
  if (fitBasis === "role_only" || !fitLevel) {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <span className="flex gap-0.5" aria-hidden>
          {FIT_LEVELS.map((l) => (
            <span key={l} className="h-2 w-3 rounded-sm border border-dashed" />
          ))}
        </span>
        <span className={labelClassName}>Fit not judged</span>
      </span>
    );
  }
  const filled = FIT_LEVELS.length - FIT_LEVELS.indexOf(fitLevel);
  const tone = muted ? "muted" : FIT_TONE[fitLevel];
  return (
    <span
      className="inline-flex items-center gap-2 text-xs font-medium"
      role="img"
      aria-label={`${FIT_LEVEL_LABELS[fitLevel]} (${filled} of 5)`}
    >
      <span className="flex gap-0.5" aria-hidden>
        {FIT_LEVELS.map((l, i) => (
          <span
            key={l}
            className={cn("h-2 w-3 rounded-sm", i < filled ? TONE_FILL[tone] : "bg-muted")}
          />
        ))}
      </span>
      <span className={cn(TONES[tone].split(" ")[0], labelClassName)}>
        {FIT_LEVEL_LABELS[fitLevel]}
      </span>
    </span>
  );
}

/** One chip per non-empty category: icon + count, label on hover. */
export function SignalChips({
  counts,
  className,
}: {
  counts: AssessmentSummary["counts"];
  className?: string;
}) {
  const keys = (Object.keys(SIGNALS) as (keyof typeof SIGNALS)[]).filter((k) => counts[k] > 0);
  if (keys.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Assessment signals">
      {keys.map((k) => {
        const { label, tone, icon: Icon } = SIGNALS[k];
        return (
          <li key={k}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium tabular-nums",
                    TONES[tone],
                  )}
                  role="img"
                  aria-label={`${counts[k]} ${label.toLowerCase()}`}
                >
                  <Icon className="size-3.5" />
                  {counts[k]}
                </span>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

/** Small evidence-class marker shown next to every point and claim. */
export function EvidenceBadge({ evidence }: { evidence: EvidenceClass }) {
  const { tone, icon: Icon } = EVIDENCE[evidence];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-sm px-1 text-[11px] leading-4 font-medium whitespace-nowrap",
        TONES[tone],
        "border-0",
      )}
    >
      <Icon className="size-3" />
      {EVIDENCE_LABELS[evidence]}
    </span>
  );
}

/** Headline, verdict, fit and counts: the part to read first. */
/** Pay as the listing states it (from the latest assessment). */
export function SalaryLabel({ salary, className }: { salary: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <BanknoteIcon aria-hidden className="size-4 shrink-0" />
      <span className="sr-only">Salary: </span>
      {salary}
    </span>
  );
}

export function SummaryHeader({
  summary,
  title,
  className,
}: {
  summary: AssessmentSummary;
  /** Job title line, when the header stands alone (chat card). */
  title?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {title}
      <p className="text-base leading-snug font-semibold text-balance">{summary.headline}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <VerdictBadge verdict={summary.verdict} />
        <FitMeter fitLevel={summary.fitLevel} fitBasis={summary.fitBasis} />
        <SignalChips counts={summary.counts} className="sm:ml-auto" />
      </div>
    </div>
  );
}
