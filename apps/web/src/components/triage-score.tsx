import { triageBand } from "@copilot/shared";
import { cn } from "cn";
import { TONES, type Tone } from "@/components/assessment-visuals";

const BAND_TONE: Record<ReturnType<typeof triageBand>, Tone> = {
  strong: "success",
  good: "info",
  mixed: "warning",
  weak: "muted",
};

/** A discovered job's triage score (0–100) as a small tinted pill; muted once decided. */
export function TriageScore({
  score,
  muted,
  className,
}: {
  score: number | null;
  muted?: boolean;
  className?: string;
}) {
  if (score === null) {
    return (
      <span
        className={cn("text-xs text-muted-foreground", className)}
        title="Scored on the next run"
      >
        Triage pending
      </span>
    );
  }
  const tone = muted ? "muted" : BAND_TONE[triageBand(score)];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
        TONES[tone],
        className,
      )}
      title="Quick triage score (0–100) against your profile; not a full assessment"
    >
      Triage {score}
    </span>
  );
}
