import {
  type DiscoveryRun,
  type FunnelResult,
  getSearchSettings,
  listDiscoveryRuns,
  type SourceRunResult,
  type SourceState,
  screenedOutSince,
  sourceSpendSince,
  sourceStates,
} from "@copilot/db";
import { DISCOVERY_SOURCE_LABELS, DISCOVERY_SOURCES } from "@copilot/shared";
import { cn } from "cn";
import { ExternalLinkIcon, SettingsIcon } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DiscoveryControls, RefreshWhileRunning } from "@/components/discovery-controls";
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
import { appDb } from "@/server/db";
import { serverEnv } from "@/server/env";

const DAY_MS = 86_400_000;
/** A backfill lets a paid source spend this many times its per-run cap (see the LinkedIn source). */
const BACKFILL_USD_FACTOR = 4;

const formatTime = (d: Date) =>
  d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const usd = (n: number) => `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`;

/** Free sources ask for credit on every page that shows their data. */
const SOURCE_SITES: Record<string, string> = {
  himalayas: "https://himalayas.app",
  linkedin: "https://www.linkedin.com/jobs",
};

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
  const [runs, settings, spent, screenedOut] = await Promise.all([
    listDiscoveryRuns(db, 20),
    getSearchSettings(db),
    sourceSpendSince(db, ["linkedin"], new Date(now - 30 * DAY_MS)),
    screenedOutSince(db, new Date(now - 7 * DAY_MS)),
  ]);
  const running = runs[0]?.status === "running";
  const states = sourceStates(runs, DISCOVERY_SOURCES);
  const linkedin = settings.sources.linkedin;
  const maxBackfillUsd = linkedin.enabled ? linkedin.maxUsdPerRun * BACKFILL_USD_FACTOR : null;
  const studio = serverEnv().AGENT_URL;

  return (
    <div className="flex flex-col gap-6">
      <RefreshWhileRunning running={running} />
      <section className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          New postings are fetched twice a day while the main checkout's dev server runs (with{" "}
          <code>DISCOVERY_SCHEDULE=on</code>). Each run asks every source for what was posted since
          its last good run. Use a backfill for a first fill or after a long break.
        </p>
        <DiscoveryControls running={running} maxBackfillUsd={maxBackfillUsd} />
      </section>

      <section aria-label="Sources" className="grid gap-3 sm:grid-cols-2">
        {states.map((state) => (
          <SourceCard
            key={state.source}
            state={state}
            enabled={settings.sources[state.source].enabled}
            spent={state.source === "linkedin" ? spent : null}
            budget={settings.apifyMonthlyBudgetUsd}
          />
        ))}
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

const STATUS_VARIANT = {
  ok: "secondary",
  partial: "outline",
  failed: "destructive",
  skipped: "outline",
} as const;

function SourceCard({
  state,
  enabled,
  spent,
  budget,
}: {
  state: SourceState;
  enabled: boolean;
  spent: number | null;
  budget: number;
}) {
  const label = DISCOVERY_SOURCE_LABELS[state.source];
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
      <div className="flex items-center gap-2">
        <a
          href={SOURCE_SITES[state.source]}
          target="_blank"
          rel="noopener"
          className="font-medium hover:underline"
        >
          {label}
        </a>
        {!enabled && <Badge variant="outline">Off</Badge>}
        {enabled && state.unhealthy && <Badge variant="destructive">Needs a look</Badge>}
        {enabled && !state.unhealthy && state.last && <Badge variant="secondary">Healthy</Badge>}
      </div>
      <p className="text-muted-foreground">
        {state.lastOkAt ? `Last good run ${formatTime(state.lastOkAt)}` : "No good run yet"}
        {spent !== null && ` · ${usd(spent)} of ${usd(budget)} in 30 days`}
      </p>
      {state.last?.message && (
        <p className="text-xs text-muted-foreground">Last run: {state.last.message}</p>
      )}
    </div>
  );
}

function RunRow({ run, studio }: { run: DiscoveryRun; studio: string }) {
  return (
    <TableRow className="align-top">
      <TableCell className="whitespace-normal">
        <div>{formatTime(run.startedAt)}</div>
        <div className="text-xs text-muted-foreground">
          {run.trigger === "schedule" ? "Scheduled" : "Manual"}
          {run.lookbackDays ? ` · ${run.lookbackDays}-day backfill` : ""}
        </div>
      </TableCell>
      <TableCell className="whitespace-normal">
        <Badge
          variant={
            run.status === "failed"
              ? "destructive"
              : run.status === "running"
                ? "outline"
                : "secondary"
          }
        >
          {run.status}
        </Badge>
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
      <TableCell className="whitespace-normal">
        <ul className="flex flex-col gap-1">
          {run.sources.map((s) => (
            <SourceLine key={s.source} result={s} />
          ))}
        </ul>
        {run.funnel && <FunnelLine funnel={run.funnel} />}
        {run.error && <p className="text-xs text-destructive">{run.error}</p>}
      </TableCell>
      <TableCell className="text-right tabular-nums">{usd(run.estimatedUsd)}</TableCell>
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
    <div className="mt-1 text-xs">
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
        <span className="block text-muted-foreground">Stopped early: {funnel.stoppedBy}</span>
      )}
    </div>
  );
}

function SourceLine({ result }: { result: SourceRunResult }) {
  const counts =
    result.status === "skipped"
      ? []
      : [
          `${result.fetched} fetched`,
          `${result.newJobs} new`,
          result.merged && `${result.merged} merged`,
          result.seen && `${result.seen} seen before`,
          `${result.filtered} screened out`,
          result.invalid && `${result.invalid} invalid`,
        ].filter(Boolean);
  return (
    <li className="text-xs">
      <span className="font-medium">{DISCOVERY_SOURCE_LABELS[result.source]}</span>{" "}
      <Badge variant={STATUS_VARIANT[result.status]} className={cn("h-4 px-1.5 text-[11px]")}>
        {result.status}
      </Badge>{" "}
      <span className="text-muted-foreground">{counts.join(" · ")}</span>
      {result.message && <span className="block text-muted-foreground">{result.message}</span>}
    </li>
  );
}
