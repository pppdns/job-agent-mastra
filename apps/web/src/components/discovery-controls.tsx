"use client";

import { ASSESS_BATCH_SIZES } from "@copilot/shared";

/** What reading one listing's facts costs on average (fast model; measured on real listings). */
const FACTS_USD_PER_JOB = 0.0015;

import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useActionState,
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import {
  type DiscoveryActionState,
  startDiscoveryAction,
  stopDiscoveryAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * A button's help on hover or focus: what it runs, whether a model is involved, what it costs.
 * The trigger is a wrapper span, so the tooltip still shows while the button is disabled.
 */
function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

/**
 * "Run now", the occasional backfill, and runs that skip fetching: triage the next batch of
 * waiting jobs, or fully assess more matches (a batch size picked here). "Stop run" while one
 * is going. `maxBackfillUsd` is what a backfill may spend.
 */
export function DiscoveryControls({
  running,
  maxBackfillUsd,
  awaitingTriage,
  awaitingFacts,
}: {
  running: boolean;
  maxBackfillUsd: number | null;
  awaitingTriage: number;
  /** Jobs whose listing facts are missing or outdated (the facts backfill reads them). */
  awaitingFacts: number;
}) {
  // The smallest batch by default: a known, low cost per click.
  const [assessLimit, setAssessLimit] = useState<number>(ASSESS_BATCH_SIZES[0]);
  // One action for every button, so the feedback line always shows the latest result.
  const [shown, action, pending] = useActionState<DiscoveryActionState, FormData>(
    (prev, formData) =>
      formData.get("run") === "stop" ? stopDiscoveryAction() : startDiscoveryAction(prev, formData),
    null,
  );
  const busy = running || pending;
  const cost = maxBackfillUsd === null ? "" : ` · up to $${maxBackfillUsd.toFixed(2)}`;
  return (
    <div className="flex flex-col gap-2">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <Hint text="Fetches new postings from every due source (free feeds; paid Apify boards cost per result), screens them in code, then reads listing facts and triages the new jobs (fast model, cents), fully assesses the best matches (main model, about $0.04 each) and emails them.">
          <Button type="submit" name="run" value="now" disabled={busy}>
            {running ? "Running…" : "Run now"}
          </Button>
        </Hint>
        <Hint text="Like Run now, but asks every source for the last 7 days and ignores each source's hours between runs. Paid boards return more results, so it costs more; the shown amount is the cap.">
          <Button type="submit" name="run" value="backfill-7" variant="outline" disabled={busy}>
            Backfill 7 days{cost}
          </Button>
        </Hint>
        <Hint text="Like Run now, but asks every source for the last 30 days and ignores each source's hours between runs. The most expensive run (many paid results); the shown amount is the cap.">
          <Button type="submit" name="run" value="backfill-30" variant="outline" disabled={busy}>
            Backfill 30 days{cost}
          </Button>
        </Hint>
        <Hint text="Fetches nothing. Scores the jobs still waiting for triage against your profile (fast model, 0–100 with a reason; cheap, about $0.002 a job), hides low scores, then assesses and emails the new matches.">
          <Button
            type="submit"
            name="run"
            value="triage"
            variant="outline"
            disabled={busy || awaitingTriage === 0}
          >
            Triage next batch · {awaitingTriage.toLocaleString("en-US")} waiting
          </Button>
        </Hint>
        {awaitingFacts > 0 && (
          <Hint text="Fetches nothing, triages nothing. For jobs whose facts are missing or outdated, a fast model (cheap, under $0.002 a job) quotes work mode, places, pay, level, languages and focus from the listing; code then checks every quote and decides whether the job is open from where you live, hiding closed ones. Fills the job chips.">
            <Button type="submit" name="run" value="extract" variant="outline" disabled={busy}>
              Read listing facts · {awaitingFacts.toLocaleString("en-US")} jobs · about $
              {(awaitingFacts * FACTS_USD_PER_JOB).toFixed(2)}
            </Button>
          </Hint>
        )}
        <span className="flex flex-wrap items-center gap-1">
          <input type="hidden" name="assessLimit" value={assessLimit} />
          <Hint text="Fetches and triages nothing. Writes full assessments for the best triaged matches that have none yet (main model, the expensive step: about $0.04 a job), up to the batch size picked next to it.">
            <Button type="submit" name="run" value="assess" variant="outline" disabled={busy}>
              Assess more matches · up to {assessLimit}
            </Button>
          </Hint>
          <fieldset className="flex items-center gap-1">
            <legend className="sr-only">Assessment batch size</legend>
            {ASSESS_BATCH_SIZES.map((n) => (
              <Button
                key={n}
                type="button"
                size="xs"
                variant={n === assessLimit ? "outline" : "ghost"}
                className={n === assessLimit ? undefined : "text-muted-foreground"}
                aria-pressed={n === assessLimit}
                onClick={() => setAssessLimit(n)}
              >
                {n}
              </Button>
            ))}
          </fieldset>
        </span>
      </form>
      <p className="text-xs text-muted-foreground">
        Assessing uses the main model, about $0.04 a job, best matches first. A bigger batch raises
        that run&apos;s spend cap to fit.
      </p>
      {running && (
        <form action={action}>
          <Button
            type="submit"
            name="run"
            value="stop"
            variant="destructive"
            size="sm"
            disabled={pending}
          >
            {pending ? "Stopping…" : "Stop run"}
          </Button>
        </form>
      )}
      {shown && (
        <p
          role="status"
          className={shown.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}
        >
          {shown.message}
        </p>
      )}
    </div>
  );
}

/**
 * Refreshes the page while a run is going, so results appear as they land: 3 s after the previous
 * refresh finished (never overlapping, so a slow server isn't buried under renders), and only
 * while the tab is visible.
 */
export function RefreshWhileRunning({ running }: { running: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const visible = useSyncExternalStore(
    subscribeToVisibility,
    () => document.visibilityState === "visible",
    () => true,
  );
  useEffect(() => {
    if (!running || !visible || refreshing) return;
    const timer = setTimeout(() => startRefresh(() => router.refresh()), 3_000);
    return () => clearTimeout(timer);
  }, [running, visible, refreshing, router]);
  return null;
}

function subscribeToVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
