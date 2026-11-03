import { type JobOverview, listJobs } from "@copilot/db";
import { RECOMMENDATIONS } from "@copilot/shared";
import { cn } from "cn";
import { Building2Icon, CheckIcon, MapPinIcon } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  FitMeter,
  SignalChips,
  TONE_FILL,
  VERDICT,
  VerdictBadge,
} from "@/components/assessment-visuals";
import { PageHeader } from "@/components/page-header";
import { RescoreButton } from "@/components/rescore-button";
import { Badge } from "@/components/ui/badge";
import { appDb } from "@/server/db";

export default function JobsPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader>
        <h1 className="text-sm font-semibold">Jobs</h1>
      </PageHeader>
      <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto p-4">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading jobs…</p>}>
          <JobList />
        </Suspense>
      </div>
    </div>
  );
}

async function JobList() {
  await connection(); // libsql is synchronous: keep these reads out of prerendering
  const jobs = await listJobs(await appDb());
  if (jobs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No jobs yet. Paste a listing or URL into a chat.
      </p>
    );
  }
  const stale = jobs.filter((j) => j.profileStale).length;
  return (
    <div className="flex flex-col gap-4">
      {stale > 0 && <RescoreButton count={stale} />}
      <VerdictTally jobs={jobs} />
      <ul className="flex flex-col gap-3" aria-label="Jobs">
        {jobs.map((job) => (
          <li key={job.id}>
            <JobRow job={job} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** How many jobs landed on each verdict. */
function VerdictTally({ jobs }: { jobs: JobOverview[] }) {
  const counts = RECOMMENDATIONS.map(
    (v) => [v, jobs.filter((j) => j.summary?.verdict === v).length] as const,
  ).filter(([, n]) => n > 0);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="mr-1 font-medium">
        {jobs.length} {jobs.length === 1 ? "job" : "jobs"}
      </span>
      {counts.map(([verdict, n]) => (
        <span key={verdict} className="inline-flex items-center gap-1.5">
          <VerdictBadge verdict={verdict} size="sm" />
          <span className="text-muted-foreground tabular-nums">{n}</span>
        </span>
      ))}
    </div>
  );
}

function JobRow({ job }: { job: JobOverview }) {
  const { summary } = job;
  return (
    <Link
      href={`/jobs/${job.id}`}
      className="relative flex flex-col gap-2 overflow-hidden rounded-xl border bg-card p-4 pl-5 transition-colors hover:bg-muted/40"
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          summary ? TONE_FILL[VERDICT[summary.verdict].tone] : "bg-border",
        )}
      />
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold">{job.title ?? "Untitled job"}</span>
          <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            {job.company && (
              <span className="inline-flex items-center gap-1">
                <Building2Icon className="size-3" />
                {job.company}
              </span>
            )}
            {job.location && (
              <span className="inline-flex items-center gap-1">
                <MapPinIcon className="size-3" />
                {job.location}
              </span>
            )}
          </span>
        </div>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {job.approvedVersion !== null && (
            <Badge>
              <CheckIcon />
              Approved v{job.approvedVersion}
            </Badge>
          )}
          {job.draftVersion !== null && (
            <Badge variant="outline" className="border-dashed">
              Draft v{job.draftVersion}
            </Badge>
          )}
          {job.pendingApproval && <Badge variant="secondary">Awaiting approval</Badge>}
          {job.profileStale && <Badge variant="destructive">Profile changed · review</Badge>}
        </span>
      </div>
      {summary ? (
        <>
          <p className="text-sm leading-snug">{summary.headline}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <VerdictBadge verdict={summary.verdict} size="sm" />
            <FitMeter fitLevel={summary.fitLevel} fitBasis={summary.fitBasis} />
            <SignalChips counts={summary.counts} className="sm:ml-auto" />
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Not assessed yet.</p>
      )}
    </Link>
  );
}
