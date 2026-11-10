import type { SourceRunResult } from "@copilot/db";
import { cn } from "cn";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  CircleXIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { Tone } from "@/components/assessment-visuals";

// Shared status look for the discovery page: one icon and color per state, used by the live
// progress panel, the runs table and the source cards.

export type DiscoveryStatus = SourceRunResult["status"] | "running" | "waiting";

const ICONS = {
  ok: CircleCheckIcon,
  partial: TriangleAlertIcon,
  failed: CircleXIcon,
  skipped: CircleMinusIcon,
  running: LoaderCircleIcon,
  waiting: CircleDashedIcon,
} as const;

/** Text color per status (icons and short labels), from the semantic signal tokens. */
export const STATUS_TEXT: Record<DiscoveryStatus, string> = {
  ok: "text-success",
  partial: "text-warning",
  failed: "text-destructive",
  skipped: "text-muted-foreground",
  running: "text-info",
  waiting: "text-muted-foreground/60",
};

/** Badge tone per status (see `TONES` in assessment-visuals). */
export const STATUS_TONE: Record<DiscoveryStatus, Tone> = {
  ok: "success",
  partial: "warning",
  failed: "destructive",
  skipped: "muted",
  running: "info",
  waiting: "muted",
};

export const STATUS_LABEL: Record<DiscoveryStatus, string> = {
  ok: "ok",
  partial: "partial",
  failed: "failed",
  skipped: "skipped",
  running: "running",
  waiting: "waiting",
};

export function StatusIcon({ status, className }: { status: DiscoveryStatus; className?: string }) {
  const Icon = ICONS[status];
  return (
    <Icon
      role="img"
      aria-label={STATUS_LABEL[status]}
      className={cn(
        "size-4 shrink-0",
        STATUS_TEXT[status],
        status === "running" && "animate-spin",
        className,
      )}
    />
  );
}

/** "45s", "3m 10s", "1h 5m". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** A thin progress bar (0–1); indeterminate when `value` is null. */
export function ProgressBar({ value, label }: { value: number | null; label: string }) {
  const pct = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn(
          "h-full rounded-full bg-info transition-[width] duration-500",
          pct === null && "w-1/3 animate-pulse",
        )}
        style={pct === null ? undefined : { width: `${pct}%` }}
      />
    </div>
  );
}
