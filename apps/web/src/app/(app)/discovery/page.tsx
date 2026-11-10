import {
  type DiscoveryRun,
  type FunnelResult,
  getSearchSettings,
  listDiscoveryRuns,
  type SourceRunResult,
  type SourceState,
  type SourceStats,
  screenedOutSince,
  sourceSpendSince,
  sourceStates,
  sourceStatsSince,
} from "@copilot/db";
import {
  DISCOVERY_SOURCE_LABELS,
  DISCOVERY_SOURCE_SITES,
  DISCOVERY_SOURCES,
  PAID_DISCOVERY_SOURCES,
} from "@copilot/shared";
import { cn } from "cn";
import { ExternalLinkIcon, LoaderCircleIcon, SettingsIcon } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import type React from "react";
import { Suspense } from "react";
import { TONES, type Tone } from "@/components/assessment-visuals";
import { DiscoveryControls, RefreshWhileRunning } from "@/components/discovery-controls";
import { RunProgress } from "@/components/discovery-run-progress";
import { formatDuration, STATUS_TEXT, StatusIcon } from "@/components/discovery-status";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { runOutcome } from "@/lib/run-outcome";
import { appDb } from "@/server/db";
import { serverEnv } from "@/server/env";

const DAY_MS = 86_400_000;
/** A backfill lets a paid source spend this many times its per-run cap (see the LinkedIn source). */
const BACKFILL_USD_FACTOR = 4;

const formatTime = (d: Date) =>
  d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const usd = (n: number) => `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`;

const percent = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";

export default function DiscoveryPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader>
        <h1 className="text-sm font-semibold">Discovery</h1>
        <Button asChild size="sm" variant="ghost" className="ml-auto">
          <Link href="/settings/search">
            <SettingsIcon />
            Search settings
          </Link>
        </Button>
      </PageHeader>
      <div className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto p-4">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading discovery…</p>}>
          <Discovery />
        </Suspense>
      </div>
    </div>
  );
}

async function Discovery() {
  await connection(); // libsql is synchronous: keep these reads out of prerendering
  const db = await appDb();
  const now = Date.now();
  const monthAgo = new Date(now - 30 * DAY_MS);
  const [runs, settings, spent, screenedOut] = await Promise.all([
    listDiscoveryRuns(db, 20),
    getSearchSettings(db),
    sourceSpendSince(db, PAID_DISCOVERY_SOURCES, monthAgo),
    screenedOutSince(db, new Date(now - 7 * DAY_MS)),
  ]);
  const stats = await sourceStatsSince(db, DISCOVERY_SOURCES, monthAgo, settings.triageThreshold);
  const current = runs[0]?.status === "running" ? runs[0] : null;
  const running = current !== null;
  const states = sourceStates(runs, DISCOVERY_SOURCES);
  const linkedin = settings.sources.linkedin;
  const maxBackfillUsd = linkedin.enabled ? linkedin.maxUsdPerRun * BACKFILL_USD_FACTOR : null;
  const studio = serverEnv().AGENT_URL;

  return (
    <div className="flex flex-col gap-6">
      <RefreshWhileRunning running={running} />
      <section className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          New postings are fetched twice a day by the hosted app (or the main checkout's dev server,
          with <code>DISCOVERY_SCHEDULE=on</code>). Each run asks every source for what was posted
          since its last good run. Use a backfill for a first fill or after a long break.
        </p>
        <DiscoveryControls running={running} maxBackfillUsd={maxBackfillUsd} />
      </section>

      {current ? (
        <RunProgress run={current} settings={settings} now={now} />
      ) : (
        runs[0] && <LastRun run={runs[0]} />
      )}

      <section aria-label="Sources" className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          Last 30 days per source: postings found and passed by the screen, matches (triage at or
          above {settings.triageThreshold}, kept, or acted on) and how many no other board had, the
          share of jobs also seen on another board, and the cost per match.
        </p>
        <div className="sm:max-w-sm">
          <BudgetBar spent={spent} budget={settings.apifyMonthlyBudgetUsd} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {states.map((state) => (
            <SourceCard
              key={state.source}
              state={state}
              stats={stats.find((s) => s.source === state.source)}
              enabled={settings.sources[state.source].enabled}
            />
          ))}
        </div>
      </section>

      <section aria-label="Runs" className="flex flex-col gap-2">
        <h2 className="font-medium">Runs</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <Table aria-label="Discovery runs">
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">Started</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead>Sources</TableHead>
                <TableHead className="w-20 text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <RunRow key={run.id} run={run} studio={studio} />
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section aria-label="Screened out" className="flex flex-col gap-2">
        <h2 className="font-medium">Screened out in the last 7 days</h2>
        <p className="text-sm text-muted-foreground">
          Postings the deterministic screen dropped, with the reason. If good jobs show up here,
          loosen the{" "}
          <Link href="/settings/search" className="underline">
            search settings
          </Link>
          ; saving re-screens them.
        </p>
        {screenedOut.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing screened out.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border text-sm">
            {screenedOut.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5">
                <span className="font-medium">{p.title}</span>
                <span className="text-muted-foreground">{p.company}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {(p.reasons ?? []).join("; ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const HEALTH: Record<"off" | "bad" | "good" | "new", { label: string; tone: Tone }> = {
  off: { label: "Off", tone: "muted" },
  bad: { label: "Needs a look", tone: "destructive" },
  good: { label: "Healthy", tone: "success" },
  new: { label: "Not run yet", tone: "muted" },
};

function ToneBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <Badge variant="outline" className={TONES[tone]}>
      {children}
    </Badge>
  );
}

function SourceCard({
  state,
  stats,
  enabled,
}: {
  state: SourceState;
  stats: SourceStats | undefined;
  enabled: boolean;
}) {
  const label = DISCOVERY_SOURCE_LABELS[state.source];
  const health = HEALTH[!enabled ? "off" : state.unhealthy ? "bad" : state.last ? "good" : "new"];
  const last = state.last;
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3 text-sm",
        enabled && state.unhealthy && "border-destructive/40",
        !enabled && "bg-muted/40",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <a
            href={DISCOVERY_SOURCE_SITES[state.source]}
            target="_blank"
            rel="noopener"
            className="font-medium hover:underline"
          >
            {label}
          </a>
          <p className="text-xs text-muted-foreground">
            {state.lastOkAt ? `Last good run ${formatTime(state.lastOkAt)}` : "No good run yet"}
          </p>
        </div>
        <ToneBadge tone={health.tone}>{health.label}</ToneBadge>
      </div>
      {stats && stats.postings > 0 ? (
        <>
          <dl
            aria-label={`${label} in the last 30 days`}
            className="grid grid-cols-3 gap-2 text-xs text-muted-foreground"
          >
            <BigStat label="Postings" value={stats.postings} />
            <BigStat label="Passed" value={stats.passed} />
            <BigStat
              label="Matches"
              value={stats.matches}
              className={stats.matches > 0 ? "text-success" : undefined}
            />
          </dl>
          <p className="text-xs text-muted-foreground tabular-nums">
            {[
              `${percent(stats.matches, stats.jobs)} match rate`,
              stats.uniqueMatches > 0 && `${stats.uniqueMatches} only here`,
              `${percent(stats.duplicates, stats.jobs)} also elsewhere`,
              stats.costUsd > 0 &&
                (stats.matches > 0 ? `${usd(stats.costUsd / stats.matches)} per match` : null),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">No postings in the last 30 days.</p>
      )}
      {last?.message && (
        <p className={cn("flex gap-1.5 text-xs", STATUS_TEXT[last.status])}>
          <StatusIcon status={last.status} className="mt-px size-3.5" />
          <span className="min-w-0">Last run: {last.message}</span>
        </p>
      )}
    </div>
  );
}

function BigStat({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className="flex flex-col">
      <dt>{label}</dt>
      <dd className={cn("text-lg font-semibold text-foreground tabular-nums", className)}>
        {value.toLocaleString("en-US")}
      </dd>
    </div>
  );
}

/** Apify spend of the paid sources (shared budget) over the last 30 days. */
function BudgetBar({ spent, budget }: { spent: number; budget: number }) {
  const share = budget > 0 ? spent / budget : 1;
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <div className="flex justify-between tabular-nums">
        <span>Apify budget (paid boards), last 30 days</span>
        <span>
          {usd(spent)} of {usd(budget)}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            share >= 0.9 ? "bg-destructive" : share >= 0.6 ? "bg-warning" : "bg-success",
          )}
          style={{ width: `${Math.max(2, Math.min(100, share * 100))}%` }}
        />
      </div>
    </div>
  );
}

const TRIGGER_LABEL: Record<DiscoveryRun["trigger"], string> = {
  schedule: "Scheduled",
  manual: "Manual",
};

/** The latest finished run in one glance: did it work, what it brought, what needs a look. */
function LastRun({ run }: { run: DiscoveryRun }) {
  const outcome = runOutcome(run);
  const newJobs = run.sources.reduce((sum, s) => sum + s.newJobs, 0);
  const duration = run.endedAt && formatDuration(run.endedAt.getTime() - run.startedAt.getTime());
  const facts = [
    `${newJobs} new jobs`,
    run.funnel && `${run.funnel.triaged} triaged`,
    run.funnel && `${run.funnel.matched} matches`,
    run.funnel && `${run.funnel.assessed} assessed`,
    usd(run.estimatedUsd),
  ].filter(Boolean);
  return (
    <section aria-label="Last run" className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">Last run</h2>
        <ToneBadge tone={outcome.tone}>{outcome.label}</ToneBadge>
        <span className="text-xs text-muted-foreground">
          {formatTime(run.startedAt)} · {TRIGGER_LABEL[run.trigger]}
          {duration ? ` · ${duration}` : ""}
        </span>
      </div>
      <p>{outcome.summary}</p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {facts.join(" · ")}
        {run.funnel?.digest &&
          ` · ${DIGEST_LABEL[run.funnel.digest.status]}: ${run.funnel.digest.message}`}
      </p>
      {outcome.problems.length > 0 && <ProblemList problems={outcome.problems} />}
    </section>
  );
}

function ProblemList({ problems }: { problems: string[] }) {
  return (
    <ul className="flex flex-col gap-0.5 text-xs text-warning">
      {problems.map((p) => (
        <li key={p} className="flex items-start gap-1.5">
          <StatusIcon status="partial" className="mt-px size-3.5" />
          <span>{p}</span>
        </li>
      ))}
    </ul>
  );
}

function RunRow({ run, studio }: { run: DiscoveryRun; studio: string }) {
  const ran = run.sources.filter((s) => s.status !== "skipped");
  const skipped = run.sources.filter((s) => s.status === "skipped");
  const newJobs = run.sources.reduce((sum, s) => sum + s.newJobs, 0);
  const duration = run.endedAt && formatDuration(run.endedAt.getTime() - run.startedAt.getTime());
  const outcome = runOutcome(run);
  return (
    <TableRow className="align-top">
      <TableCell className="whitespace-normal align-top">
        <div>{formatTime(run.startedAt)}</div>
        <div className="text-xs text-muted-foreground">
          {TRIGGER_LABEL[run.trigger]}
          {run.lookbackDays ? ` · ${run.lookbackDays}-day backfill` : ""}
          {duration ? ` · ${duration}` : ""}
        </div>
      </TableCell>
      <TableCell className="whitespace-normal align-top">
        <ToneBadge tone={outcome.tone}>
          {run.status === "running" && <LoaderCircleIcon className="animate-spin" />}
          {outcome.label}
        </ToneBadge>
        {run.workflowRunId && (
          <a
            href={`${studio}/workflows/discover-jobs/graph/${encodeURIComponent(run.workflowRunId)}`}
            target="_blank"
            rel="noopener"
            className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            Studio <ExternalLinkIcon className="size-3" />
          </a>
        )}
      </TableCell>
      <TableCell className="whitespace-normal align-top">
        <p className="mb-1.5 text-sm">
          <span className="font-medium tabular-nums">{newJobs}</span> new jobs
          {run.funnel && (
            <>
              {" · "}
              <span
                className={cn("font-medium tabular-nums", run.funnel.matched > 0 && "text-success")}
              >
                {run.funnel.matched}
              </span>{" "}
              matches
            </>
          )}
        </p>
        <ul className="flex flex-col gap-0.5">
          {ran.map((s) => (
            <SourceLine key={s.source} result={s} />
          ))}
        </ul>
        {skipped.length > 0 && <SkippedLine results={skipped} />}
        {run.funnel && <FunnelLine funnel={run.funnel} />}
        {outcome.problems.length > 0 && (
          <div className="mt-1.5">
            <ProblemList problems={outcome.problems} />
          </div>
        )}
        {run.status === "interrupted" && !run.error && (
          <p className="text-xs text-warning">Cut off by a server restart.</p>
        )}
        {run.error && (
          <p
            className={cn(
              "text-xs",
              run.status === "failed" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {run.error}
          </p>
        )}
      </TableCell>
      <TableCell className="text-right align-top tabular-nums">{usd(run.estimatedUsd)}</TableCell>
    </TableRow>
  );
}

const DIGEST_LABEL = { sent: "email sent", skipped: "no email", failed: "email failed" } as const;

function FunnelLine({ funnel }: { funnel: FunnelResult }) {
  const parts = [
    `${funnel.triaged} triaged`,
    funnel.triageFailed && `${funnel.triageFailed} failed`,
    funnel.triagePending && `${funnel.triagePending} waiting`,
    `${funnel.matched} matches`,
    `${funnel.assessed} assessed`,
    funnel.assessFailed && `${funnel.assessFailed} assessments failed`,
    `models ${usd(funnel.llmUsd)}`,
  ].filter(Boolean);
  return (
    <div className="mt-1.5 border-t pt-1.5 text-xs">
      <span className="font-medium">Funnel</span>{" "}
      <span className="text-muted-foreground">{parts.join(" · ")}</span>
      {funnel.digest && (
        <span
          className={cn(
            "block",
            funnel.digest.status === "failed" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {DIGEST_LABEL[funnel.digest.status]}: {funnel.digest.message}
        </span>
      )}
      {funnel.stoppedBy && (
        <span className="block text-warning">Stopped early: {funnel.stoppedBy}</span>
      )}
    </div>
  );
}

function SourceLine({ result }: { result: SourceRunResult }) {
  const counts = [
    `${result.fetched} fetched`,
    `${result.newJobs} new`,
    result.merged && `${result.merged} merged`,
    result.seen && `${result.seen} seen before`,
    `${result.filtered} screened out`,
    result.invalid && `${result.invalid} invalid`,
    result.costUsd > 0 && usd(result.costUsd),
  ].filter(Boolean);
  return (
    <li className="flex items-start gap-1.5 text-xs">
      <StatusIcon status={result.status} className="mt-px size-3.5" />
      <div className="min-w-0">
        <span className="font-medium">{DISCOVERY_SOURCE_LABELS[result.source]}</span>{" "}
        <span className="text-muted-foreground tabular-nums">{counts.join(" · ")}</span>
        {result.message && (
          <span className={cn("block", STATUS_TEXT[result.status])}>{result.message}</span>
        )}
      </div>
    </li>
  );
}

/** Skipped sources in one line per reason (e.g. "turned off in search settings"). */
function SkippedLine({ results }: { results: SourceRunResult[] }) {
  const byReason = new Map<string, string[]>();
  for (const r of results) {
    const reason = r.message ?? "skipped";
    byReason.set(reason, [...(byReason.get(reason) ?? []), DISCOVERY_SOURCE_LABELS[r.source]]);
  }
  return (
    <ul className="mt-0.5 flex flex-col gap-0.5">
      {[...byReason].map(([reason, labels]) => (
        <li key={reason} className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <StatusIcon status="skipped" className="mt-px size-3.5" />
          <span>
            Skipped {labels.join(", ")} ({reason})
          </span>
        </li>
      ))}
    </ul>
  );
}
