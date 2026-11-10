import {
  DISCOVERY_STEPS,
  type DiscoveryRun,
  type DiscoveryStep,
  type SourceRunResult,
} from "@copilot/db";
import { DISCOVERY_SOURCE_LABELS, DISCOVERY_SOURCES, type SearchSettings } from "@copilot/shared";
import { cn } from "cn";
import {
  type DiscoveryStatus,
  formatDuration,
  ProgressBar,
  STATUS_TEXT,
  StatusIcon,
} from "@/components/discovery-status";

// The running run, live: which step it is on, each source (done, running, waiting) and the
// work count of the current step. Rendered on the server; the page refreshes every few seconds.

const STEP_LABEL: Record<DiscoveryStep, string> = {
  fetch: "Fetch sources",
  triage: "Triage",
  assess: "Assess best",
  report: "Email",
};

export function RunProgress({
  run,
  settings,
  now,
}: {
  run: DiscoveryRun;
  settings: SearchSettings;
  now: number;
}) {
  const progress = run.progress;
  const step = progress?.step ?? "fetch";
  const stepIndex = DISCOVERY_STEPS.indexOf(step);
  const sources = DISCOVERY_SOURCES.filter(
    (id) => settings.sources[id].enabled || run.sources.some((s) => s.source === id),
  );
  const finished = run.sources.filter((s) => sources.includes(s.source)).length;
  const since = (iso: string | undefined) =>
    iso ? formatDuration(now - new Date(iso).getTime()) : null;
  const newJobs = run.sources.reduce((sum, s) => sum + s.newJobs, 0);

  const work =
    progress?.total !== undefined && progress.total > 0
      ? { done: progress.done ?? 0, total: progress.total }
      : null;
  const bar =
    step === "fetch"
      ? sources.length > 0
        ? finished / sources.length
        : null
      : work
        ? work.done / work.total
        : null;
  const updated = progress ? now - new Date(progress.updatedAt).getTime() : null;

  return (
    <section
      aria-label="Run in progress"
      className="flex flex-col gap-4 rounded-xl border border-info/30 bg-info/5 p-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 font-medium">
          <StatusIcon status="running" />
          {run.trigger === "schedule" ? "Scheduled run" : "Manual run"} in progress
        </h2>
        <span className="text-sm text-muted-foreground tabular-nums">
          running for {formatDuration(now - run.startedAt.getTime())}
          {newJobs > 0 && ` · ${newJobs} new jobs so far`}
        </span>
      </div>

      <ol aria-label="Steps" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {DISCOVERY_STEPS.map((s, i) => {
          const state = i < stepIndex ? "done" : i === stepIndex ? "current" : "next";
          return (
            <li
              key={s}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                state === "current" && "border-info/40 bg-background font-medium shadow-xs",
                state === "next" && "text-muted-foreground",
              )}
            >
              <StatusIcon
                status={state === "done" ? "ok" : state === "current" ? "running" : "waiting"}
              />
              <span className="truncate">{STEP_LABEL[s]}</span>
              {state === "current" && (
                <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
                  {since(progress?.stepStartedAt)}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>
            {step === "fetch"
              ? `${finished} of ${sources.length} sources done`
              : work
                ? `${work.done} of ${work.total} jobs ${step === "triage" ? "triaged" : "assessed"}`
                : step === "report"
                  ? "Sending the digest"
                  : "Starting"}
          </span>
          {updated !== null && updated > 60_000 && (
            <span>last update {formatDuration(updated)} ago</span>
          )}
        </div>
        <ProgressBar value={bar} label={STEP_LABEL[step]} />
      </div>

      <ul aria-label="Sources" className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {sources.map((id) => {
          const result = run.sources.find((s) => s.source === id);
          const current = !result && progress?.step === "fetch" && progress.source === id;
          const status: DiscoveryStatus = result
            ? result.status
            : current
              ? "running"
              : step === "fetch"
                ? "waiting"
                : "skipped";
          return (
            <li key={id} className="flex min-w-0 items-start gap-2 py-0.5">
              <StatusIcon status={status} className="mt-0.5" />
              <span className={cn("shrink-0", current && "font-medium")}>
                {DISCOVERY_SOURCE_LABELS[id]}
              </span>
              <span
                className={cn(
                  "min-w-0 truncate text-xs leading-5 tabular-nums",
                  result ? STATUS_TEXT[result.status] : "text-muted-foreground",
                  result?.status === "ok" && "text-muted-foreground",
                )}
              >
                {result
                  ? sourceSummary(result)
                  : current
                    ? [
                        progress.total
                          ? `search ${Math.min((progress.done ?? 0) + 1, progress.total)} of ${progress.total}`
                          : null,
                        progress.label,
                        since(progress.sourceStartedAt),
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : status === "waiting"
                      ? "waiting"
                      : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function sourceSummary(result: SourceRunResult): string {
  if (result.status === "skipped") return result.message ?? "skipped";
  if (result.status === "failed") return result.message ?? "failed";
  return [
    `${result.newJobs} new`,
    `${result.fetched} fetched`,
    formatDuration(result.durationMs),
    result.status === "partial" ? "partial" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
