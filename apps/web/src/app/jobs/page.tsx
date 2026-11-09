import { type JobOverview, listJobs, searchJobIds } from "@copilot/db";
import { cn } from "cn";
import { SearchIcon } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  FIT_TONE,
  FitMeter,
  SalaryLabel,
  TONE_FILL,
  TONES,
  VerdictIcon,
} from "@/components/assessment-visuals";
import { JobStatusMenu } from "@/components/job-status-menu";
import { PageHeader } from "@/components/page-header";
import { RescoreAllButton, RescoreButton } from "@/components/rescore-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { jobAge } from "@/lib/job-age";
import {
  inTab,
  JOB_SORTS,
  JOB_TAB_LABELS,
  JOB_TABS,
  type JobListParams,
  jobListHref,
  parseJobListParams,
  sortJobs,
  tabCounts,
} from "@/lib/job-list";
import { appDb } from "@/server/db";

/** Enough to cover every saved job when searching; the list itself has no paging yet. */
const MAX_SEARCH_RESULTS = 500;

export default function JobsPage({ searchParams }: PageProps<"/jobs">) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader>
        <h1 className="text-sm font-semibold">Jobs</h1>
      </PageHeader>
      <div className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto p-4">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading jobs…</p>}>
          <JobList searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function JobList({ searchParams }: Pick<PageProps<"/jobs">, "searchParams">) {
  await connection(); // libsql is synchronous: keep these reads out of prerendering
  const params = parseJobListParams(await searchParams);
  const db = await appDb();
  const all = params.q
    ? await listJobs(db, await searchJobIds(db, params.q, MAX_SEARCH_RESULTS))
    : await listJobs(db);
  if (all.length === 0 && !params.q) {
    return (
      <p className="text-sm text-muted-foreground">
        No jobs yet. Paste a listing or URL into a chat.
      </p>
    );
  }
  const counts = tabCounts(all);
  const jobs = sortJobs(
    all.filter((j) => inTab(j, params.tab)),
    params.sort,
  );
  const active = all.filter((j) => j.archivedAt === null && j.draftVersion !== null);
  const stale = params.q ? 0 : active.filter((j) => j.profileStale).length;
  return (
    <div className="flex flex-col gap-4">
      {stale > 0 && <RescoreButton count={stale} />}
      <div className="flex flex-wrap items-center gap-2">
        <SearchForm params={params} />
        <SortToggle params={params} />
        {!params.q && active.length > 0 && <RescoreAllButton count={active.length} />}
      </div>
      <StatusTabs params={params} counts={counts} />
      {jobs.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {params.q
            ? `No ${JOB_TAB_LABELS[params.tab].toLowerCase()} jobs match “${params.q}”.`
            : "No jobs here."}
        </p>
      ) : (
        <JobTable jobs={jobs} now={new Date()} />
      )}
    </div>
  );
}

/** Plain GET form: the search lives in the URL, next to tab and sort. */
function SearchForm({ params }: { params: JobListParams }) {
  return (
    <search className="relative min-w-48 flex-1">
      <form action="/jobs">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          name="q"
          defaultValue={params.q}
          placeholder="Search title, company, location…"
          aria-label="Search jobs"
          className="pl-8"
        />
        {params.tab !== "active" && <input type="hidden" name="tab" value={params.tab} />}
        {params.sort !== "latest" && <input type="hidden" name="sort" value={params.sort} />}
      </form>
    </search>
  );
}

function SortToggle({ params }: { params: JobListParams }) {
  return (
    <nav aria-label="Sort jobs" className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
      {Object.entries(JOB_SORTS).map(([sort, label]) => {
        const current = sort === params.sort;
        return (
          <Button
            key={sort}
            asChild
            size="sm"
            variant={current ? "secondary" : "ghost"}
            className={cn(current && "bg-background shadow-xs hover:bg-background")}
          >
            <Link
              href={jobListHref({ ...params, sort: sort as JobListParams["sort"] })}
              aria-current={current ? "page" : undefined}
              replace
              scroll={false}
            >
              {label}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}

function StatusTabs({
  params,
  counts,
}: {
  params: JobListParams;
  counts: ReturnType<typeof tabCounts>;
}) {
  return (
    <nav aria-label="Job status" className="-mb-1 flex gap-1 overflow-x-auto border-b">
      {JOB_TABS.map((tab) => {
        const current = tab === params.tab;
        return (
          <Link
            key={tab}
            href={jobListHref({ ...params, tab })}
            aria-current={current ? "page" : undefined}
            replace
            scroll={false}
            className={cn(
              "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors",
              current
                ? "border-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
              tab === "archived" && "ml-auto",
            )}
          >
            {JOB_TAB_LABELS[tab]}
            <span className="text-xs text-muted-foreground tabular-nums">{counts[tab]}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function JobTable({ jobs, now }: { jobs: JobOverview[]; now: Date }) {
  return (
    <Table aria-label="Jobs" className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-auto">Job</TableHead>
          <TableHead className="hidden w-36 sm:table-cell">Age</TableHead>
          <TableHead className="w-24 sm:w-44">Fit</TableHead>
          <TableHead className="w-32 text-right">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <JobRow key={job.id} job={job} now={now} />
        ))}
      </TableBody>
    </Table>
  );
}

/** One row; the title link covers the row, the status menu and tooltips sit above it. */
function JobRow({ job, now }: { job: JobOverview; now: Date }) {
  const { summary } = job;
  const title = job.title ?? "Untitled job";
  const meta = [job.company, job.location].filter(Boolean).join(" · ");
  return (
    <TableRow className={cn("relative", job.archivedAt && "text-muted-foreground")}>
      <TableCell className="py-2.5 pl-4 whitespace-normal">
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-1 left-0 w-1 rounded-full",
            summary?.fitLevel && summary.fitBasis === "with_profile"
              ? TONE_FILL[FIT_TONE[summary.fitLevel]]
              : "bg-border",
          )}
        />
        <Link
          href={`/jobs/${job.id}`}
          className="font-medium after:absolute after:inset-0 hover:underline"
        >
          {title}
        </Link>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {meta && <span className="truncate">{meta}</span>}
          {summary?.salary && <SalaryLabel salary={summary.salary} className="[&>svg]:size-3.5" />}
          <AgePill job={job} now={now} compact className="sm:hidden" />
          <JobFlags job={job} />
        </div>
        {summary && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground" title={summary.headline}>
            {summary.headline}
          </p>
        )}
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <AgePill job={job} now={now} />
      </TableCell>
      <TableCell>
        {summary ? (
          <span className="flex items-center gap-2">
            <FitMeter
              fitLevel={summary.fitLevel}
              fitBasis={summary.fitBasis}
              labelClassName="max-sm:sr-only"
            />
            <VerdictIcon verdict={summary.verdict} className="relative z-10" />
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Not assessed</span>
        )}
      </TableCell>
      <TableCell className="relative z-10 text-right">
        <JobStatusMenu
          jobId={job.id}
          title={title}
          status={job.status}
          archived={job.archivedAt !== null}
        />
      </TableCell>
    </TableRow>
  );
}

/** Since the company posted the job (else since it was saved), tinted by freshness. */
function AgePill({
  job,
  now,
  compact,
  className,
}: {
  job: JobOverview;
  now: Date;
  /** "~3w" instead of "Posted ~3w ago" (narrow screens). */
  compact?: boolean;
  className?: string;
}) {
  const { label, short, tone, tooltip } = jobAge(job, now);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A button so keyboard users can open the tooltip with the full dates. */}
        <button
          type="button"
          className={cn(
            "relative z-10 inline-flex items-center rounded-full border font-medium whitespace-nowrap tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            compact ? "h-4 px-1.5 text-[11px]" : "px-2 py-0.5 text-xs",
            TONES[tone],
            className,
          )}
        >
          <time dateTime={(job.postedAt ?? job.createdAt).toISOString()}>
            {compact ? short : label}
          </time>
          <span className="sr-only">. {tooltip}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/** Only states that need attention: a changed profile. */
function JobFlags({ job }: { job: JobOverview }) {
  return job.profileStale ? (
    <Badge variant="destructive" className="h-4 px-1.5 text-[11px]">
      Profile changed · review
    </Badge>
  ) : null;
}
