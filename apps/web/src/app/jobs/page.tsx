import { type JobOverview, listJobs, searchJobIds } from "@copilot/db";
import { cn } from "cn";
import { SearchIcon } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  FitMeter,
  SalaryLabel,
  TONE_FILL,
  VERDICT,
  VerdictBadge,
} from "@/components/assessment-visuals";
import { JobStatusMenu } from "@/components/job-status-menu";
import { PageHeader } from "@/components/page-header";
import { RescoreButton } from "@/components/rescore-button";
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
  const stale = params.q ? 0 : all.filter((j) => j.profileStale && j.archivedAt === null).length;
  return (
    <div className="flex flex-col gap-4">
      {stale > 0 && <RescoreButton count={stale} />}
      <div className="flex flex-wrap items-center gap-2">
        <SearchForm params={params} />
        <SortToggle params={params} />
      </div>
      <StatusTabs params={params} counts={counts} />
      {jobs.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {params.q
            ? `No ${JOB_TAB_LABELS[params.tab].toLowerCase()} jobs match “${params.q}”.`
            : "No jobs here."}
        </p>
      ) : (
        <JobTable jobs={jobs} />
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

const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

function JobTable({ jobs }: { jobs: JobOverview[] }) {
  return (
    <Table aria-label="Jobs" className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-auto">Job</TableHead>
          <TableHead className="w-36">Verdict</TableHead>
          <TableHead className="hidden w-36 md:table-cell">Fit</TableHead>
          <TableHead className="hidden w-16 sm:table-cell">Added</TableHead>
          <TableHead className="w-32 text-right">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <JobRow key={job.id} job={job} />
        ))}
      </TableBody>
    </Table>
  );
}

/** One row; the title link covers the row, the status menu sits above it. */
function JobRow({ job }: { job: JobOverview }) {
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
            summary ? TONE_FILL[VERDICT[summary.verdict].tone] : "bg-border",
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
          <JobFlags job={job} />
        </div>
        {summary && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground" title={summary.headline}>
            {summary.headline}
          </p>
        )}
      </TableCell>
      <TableCell>
        {summary ? (
          <VerdictBadge verdict={summary.verdict} size="sm" />
        ) : (
          <span className="text-xs text-muted-foreground">Not assessed</span>
        )}
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {summary && <FitMeter fitLevel={summary.fitLevel} fitBasis={summary.fitBasis} />}
      </TableCell>
      <TableCell className="hidden text-xs text-muted-foreground tabular-nums sm:table-cell">
        <time dateTime={job.createdAt.toISOString()}>{dateFormat.format(job.createdAt)}</time>
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

/** Only states that need attention: a changed profile. */
function JobFlags({ job }: { job: JobOverview }) {
  return job.profileStale ? (
    <Badge variant="destructive" className="h-4 px-1.5 text-[11px]">
      Profile changed · review
    </Badge>
  ) : null;
}
