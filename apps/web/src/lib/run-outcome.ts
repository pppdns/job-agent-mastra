import type { DiscoveryRun } from "@copilot/db";
import { DISCOVERY_SOURCE_LABELS } from "@copilot/shared";
import type { Tone } from "@/components/assessment-visuals";

export type RunOutcome = {
  /** Short label for badges ("All good", "2 problems", "Failed", …). */
  label: string;
  tone: Tone;
  /** One sentence for the last-run panel. */
  summary: string;
  problems: string[];
};

/**
 * What went wrong in a run. The report step saves the problems it emailed
 * (`funnel.digest.problems`); runs that never reached it fall back to their failed or partial
 * sources and a failed funnel step.
 */
export function runProblems(run: Pick<DiscoveryRun, "sources" | "funnel">): string[] {
  const digest = run.funnel?.digest;
  if (digest) return digest.problems ?? [];
  const problems = run.sources.flatMap((s) => {
    const label = DISCOVERY_SOURCE_LABELS[s.source];
    if (s.status === "failed") return [`${label} failed: ${s.message ?? "unknown error"}`];
    if (s.status === "partial" && s.failures?.length)
      return [`${label}: ${s.failures.length} failed (${s.failures[0]})`];
    return [];
  });
  const stopped = run.funnel?.stoppedBy;
  if (stopped && / failed: /.test(stopped)) problems.push(stopped);
  return problems;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A run's outcome in words: did it work, and what needs a look. */
export function runOutcome(
  run: Pick<DiscoveryRun, "status" | "sources" | "funnel" | "error">,
): RunOutcome {
  const problems = runProblems(run);
  switch (run.status) {
    case "running":
      return { label: "Running", tone: "info", summary: "Running now.", problems };
    case "failed":
      return {
        label: "Failed",
        tone: "destructive",
        summary: run.error ?? "Every source that ran failed.",
        problems,
      };
    case "interrupted":
      return {
        label: "Interrupted",
        tone: "warning",
        summary:
          run.error ??
          "Cut off by a server restart (a deploy). What finished is kept; the next run catches up.",
        problems,
      };
    case "completed":
      return problems.length === 0
        ? { label: "All good", tone: "success", summary: "Completed without problems.", problems }
        : {
            label: plural(problems.length, "problem"),
            tone: "warning",
            summary: `Completed with ${plural(problems.length, "problem")}.`,
            problems,
          };
  }
}
