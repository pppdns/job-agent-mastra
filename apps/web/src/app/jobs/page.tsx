import {
  assessedJobCounts,
  belowThresholdJobs,
  companyJobCounts,
  type JobOverview,
  jobTabCounts,
  listJobsPage,
  postingSourcesByJob,
  screenedOutPostings,
  searchJobIds,
  staleTriageCount,
} from "@copilot/db";
import { DISCOVERY_SOURCE_LABELS, type DiscoverySource } from "@copilot/shared";
import { cn } from "cn";
import { RadarIcon, SearchIcon } from "lucide-react";
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
import { JobFilters } from "@/components/job-filters";
import { BulkBar, JobSelection, RowCheckbox, SelectAllCheckbox } from "@/components/job-selection";
import { JobStatusMenu } from "@/components/job-status-menu";
import { KeepButton, RetriageButton } from "@/components/keep-buttons";
import { PageHeader } from "@/components/page-header";
import { RescoreAllButton, RescoreButton } from "@/components/rescore-button";
import { TriageScore } from "@/components/triage-score";
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
import { type Age, jobAge, stageAge } from "@/lib/job-age";
import { fitMatters, quietStatus, showsStageAge } from "@/lib/job-emphasis";
import {
  hasFilters,
  JOB_SORTS,
  JOB_TAB_LABELS,
  JOB_TABS,
  JOBS_PAGE_SIZE,
  type JobListParams,
  type JobTab,
  jobListHref,
  parseJobListParams,
  withParams,
} from "@/lib/job-list";
import { appDb } from "@/server/db";

/** Search results considered (best first); the page shows them 50 at a time. */
const MAX_SEARCH_RESULTS = 500;
/** How far back the Screened out tab lists dropped postings. */
const SCREENED_DAYS = 30;

export default function JobsPage({ searchParams }: PageProps<"/jobs">) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader>
        <h1 className="text-sm font-semibold">Jobs</h1>
        <Button asChild size="sm" variant="ghost" className="ml-auto">
          <Link href="/discovery">
            <RadarIcon />
            Discovery
          </Link>
        </Button>
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
  const ids = params.q ? await searchJobIds(db, params.q, MAX_SEARCH_RESULTS) : undefined;
  const filters = {
    source: params.source,
    minScore: params.minScore,
    postedWithinDays: params.postedWithinDays,
    unseen: params.unseen,
  };
  const [counts, assessed, staleTriage, screenedCount] = await Promise.all([
    jobTabCounts(db, { ...filters, ids }),
    assessedJobCounts(db),
    staleTriageCount(db),
    screenedTotal(db),
  ]);
  const allCounts = { ...counts, screened: screenedCount };
  if (
    counts.active + counts.archived === 0 &&
    !params.q &&
    !hasFilters(params) &&
    screenedCount === 0
  ) {
    return (
      <p className="text-sm text-muted-foreground">
        No jobs yet. Paste a listing or URL into a chat, or{" "}
        <Link href="/discovery" className="underline">
          run discovery
        </Link>
        .
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {!params.q && assessed.stale > 0 && <RescoreButton count={assessed.stale} />}
      {!params.q && staleTriage > 0 && <RetriageButton count={staleTriage} />}
      <div className="flex flex-wrap items-center gap-2">
        <SearchForm params={params} />
        {params.tab !== "screened" && <SortToggle params={params} />}
        {!params.q && assessed.active > 0 && <RescoreAllButton count={assessed.active} />}
      </div>
      {params.tab !== "screened" && <JobFilters params={params} />}
      <StatusTabs params={params} counts={allCounts} />
      {params.tab === "screened" ? (
        <ScreenedOut params={params} />
      ) : (
        <JobPage params={params} ids={ids} filters={filters} />
      )}
    </div>
  );
}

async function screenedTotal(db: Awaited<ReturnType<typeof appDb>>) {
  const [below, dropped] = await Promise.all([
    belowThresholdJobs(db, { limit: 0 }),
    screenedOutPostings(db, { since: daysAgo(SCREENED_DAYS), limit: 0 }),
  ]);
  return below.total + dropped.total;
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

async function JobPage({
  params,
  ids,
  filters,
}: {
  params: JobListParams;
  ids: string[] | undefined;
  filters: Parameters<typeof jobTabCounts>[1];
}) {
  if (params.tab === "screened") return null;
  const db = await appDb();
  const { jobs, total } = await listJobsPage(db, {
    ...filters,
    tab: params.tab,
    sort: params.sort,
    ids,
    limit: JOBS_PAGE_SIZE,
    offset: (params.page - 1) * JOBS_PAGE_SIZE,
  });
  if (jobs.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {params.q
          ? `No ${JOB_TAB_LABELS[params.tab].toLowerCase()} jobs match “${params.q}”.`
          : hasFilters(params)
            ? "No jobs match these filters."
            : "No jobs here."}
      </p>
    );
  }
  const [sources, perCompany] = await Promise.all([
    postingSourcesByJob(
      db,
      jobs.filter((j) => j.origin === "discovery").map((j) => j.id),
    ),
    companyJobCounts(db, [...new Set(jobs.flatMap((j) => (j.companyKey ? [j.companyKey] : [])))]),
  ]);
  return (
    <JobSelection>
      <BulkBar />
      <JobTable
        jobs={jobs}
        tab={params.tab}
        now={new Date()}
        sources={sources}
        perCompany={perCompany}
      />
      <Pager params={params} total={total} shown={jobs.length} />
    </JobSelection>
  );
}

function Pager({ params, total, shown }: { params: JobListParams; total: number; shown: number }) {
  const from = (params.page - 1) * JOBS_PAGE_SIZE + 1;
  const pages = Math.max(1, Math.ceil(total / JOBS_PAGE_SIZE));
  if (pages === 1) return null;
  return (
    <nav aria-label="Pages" className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground tabular-nums">
        {from}–{from + shown - 1} of {total}
      </span>
      <span className="ml-auto flex gap-1">
        {params.page > 1 && (
          <Button asChild size="sm" variant="outline">
            <Link href={jobListHref({ ...params, page: params.page - 1 })} scroll={false}>
              Previous
            </Link>
          </Button>
        )}
        {params.page < pages && (
          <Button asChild size="sm" variant="outline">
            <Link href={jobListHref({ ...params, page: params.page + 1 })} scroll={false}>
              Next
            </Link>
          </Button>
        )}
      </span>
    </nav>
  );
}

/** What discovery hid: jobs under the triage threshold, and postings the screen dropped. */
async function ScreenedOut({ params }: { params: JobListParams }) {
  const db = await appDb();
  const offset = (params.page - 1) * JOBS_PAGE_SIZE;
  const [below, dropped] = await Promise.all([
    belowThresholdJobs(db, { limit: JOBS_PAGE_SIZE, offset }),
    screenedOutPostings(db, { since: daysAgo(SCREENED_DAYS), limit: JOBS_PAGE_SIZE, offset }),
  ]);
  const more = below.total > offset + JOBS_PAGE_SIZE || dropped.total > offset + JOBS_PAGE_SIZE;
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Below the triage threshold" className="flex flex-col gap-2">
        <h2 className="font-medium">
          Below the triage threshold{" "}
          <span className="text-sm font-normal text-muted-foreground">{below.total}</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          Discovered jobs the quick triage scored under your threshold (set in the{" "}
          <Link href="/settings/search" className="underline">
            search settings
          </Link>
          ). Keep one to see it in your list anyway.
        </p>
        {below.jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing here.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border text-sm">
            {below.jobs.map((job) => (
              <li
                key={job.id}
                className="relative flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
              >
                <TriageScore score={job.triageScore} />
                <span className="min-w-0 flex-1">
                  <Link
                    href={`/jobs/${job.id}`}
                    className="font-medium after:absolute after:inset-0 hover:underline"
                  >
                    {job.title ?? "Untitled job"}
                  </Link>{" "}
                  <span className="text-muted-foreground">
                    {[job.company, job.location].filter(Boolean).join(" · ")}
                  </span>
                  {job.triageReason && (
                    <span className="block text-xs text-muted-foreground">{job.triageReason}</span>
                  )}
                </span>
                <KeepButton kind="job" id={job.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Dropped by the screen" className="flex flex-col gap-2">
        <h2 className="font-medium">
          Dropped by the screen{" "}
          <span className="text-sm font-normal text-muted-foreground">{dropped.total}</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          Postings of the last {SCREENED_DAYS} days that never became jobs, with the reason. Loosen
          the search settings to let similar ones through, or keep one.
        </p>
        {dropped.postings.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing here.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border text-sm">
            {dropped.postings.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium hover:underline"
                  >
                    {p.title}
                  </a>{" "}
                  <span className="text-muted-foreground">
                    {[p.company, p.location].filter(Boolean).join(" · ")} · via{" "}
                    {DISCOVERY_SOURCE_LABELS[p.source]}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {(p.reasons ?? []).join("; ")}
                  </span>
                </span>
                <KeepButton kind="posting" id={p.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {(params.page > 1 || more) && (
        <nav aria-label="Pages" className="flex justify-end gap-1">
          {params.page > 1 && (
            <Button asChild size="sm" variant="outline">
              <Link href={jobListHref({ ...params, page: params.page - 1 })}>Previous</Link>
            </Button>
          )}
          {more && (
            <Button asChild size="sm" variant="outline">
              <Link href={jobListHref({ ...params, page: params.page + 1 })}>Next</Link>
            </Button>
          )}
        </nav>
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
              href={withParams(params, { sort: sort as JobListParams["sort"] })}
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

function StatusTabs({ params, counts }: { params: JobListParams; counts: Record<JobTab, number> }) {
  return (
    <nav aria-label="Job status" className="-mb-1 flex gap-1 overflow-x-auto border-b">
      {JOB_TABS.map((tab) => {
        const current = tab === params.tab;
        return (
          <Link
            key={tab}
            href={withParams(params, { tab })}
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

/** Per-tab emphasis (`src/lib/job-emphasis.ts`): color marks decisions that are still open. */
function JobTable({
  jobs,
  tab,
  now,
  sources,
  perCompany,
}: {
  jobs: JobOverview[];
  tab: JobTab;
  now: Date;
  sources: Record<string, DiscoverySource[]>;
  perCompany: Record<string, number>;
}) {
  return (
    <Table aria-label="Jobs" className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-8 pl-3">
            <SelectAllCheckbox jobIds={jobs.map((j) => j.id)} />
          </TableHead>
          <TableHead className="w-auto">Job</TableHead>
          <TableHead className="hidden w-40 sm:table-cell">
            {showsStageAge(tab) ? "In stage" : "Age"}
          </TableHead>
          <TableHead className="w-24 sm:w-44">Fit</TableHead>
          <TableHead className="w-32 text-right">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            tab={tab}
            now={now}
            sources={sources[job.id] ?? []}
            moreAtCompany={job.companyKey ? (perCompany[job.companyKey] ?? 1) - 1 : 0}
          />
        ))}
      </TableBody>
    </Table>
  );
}

/** One row; the title link covers the row, the status menu and tooltips sit above it. */
function JobRow({
  job,
  tab,
  now,
  sources,
  moreAtCompany,
}: {
  job: JobOverview;
  tab: JobTab;
  now: Date;
  sources: DiscoverySource[];
  /** Other visible, active jobs at the same company. */
  moreAtCompany: number;
}) {
  const { summary } = job;
  const age = showsStageAge(tab) ? stageAge(job, now) : jobAge(job, now);
  const fitColored = fitMatters(job);
  const title = job.title ?? "Untitled job";
  const meta = [job.company, job.location].filter(Boolean).join(" · ");
  return (
    <TableRow className={cn("relative", job.archivedAt && "text-muted-foreground")}>
      <TableCell className="pl-3 align-top pt-3">
        <RowCheckbox jobId={job.id} title={title} />
      </TableCell>
      <TableCell className="py-2.5 pl-2 whitespace-normal">
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-1 left-0 w-1 rounded-full",
            fitColored && summary?.fitLevel && summary.fitBasis === "with_profile"
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
          <AgePill age={age} compact className="sm:hidden" />
          <JobFlags job={job} />
          {job.origin === "discovery" && job.seenAt === null && job.triageScore !== null && (
            <Badge className="h-4 px-1.5 text-[11px]">New</Badge>
          )}
          {sources.map((source) => (
            <Badge key={source} variant="outline" className="h-4 px-1.5 text-[11px]">
              {DISCOVERY_SOURCE_LABELS[source]}
            </Badge>
          ))}
          {moreAtCompany > 0 && job.companyKey && (
            <Link
              href={`/companies/${encodeURIComponent(job.companyKey)}`}
              className="relative z-10 hover:underline"
            >
              +{moreAtCompany} more role{moreAtCompany === 1 ? "" : "s"} here
            </Link>
          )}
        </div>
        {summary ? (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground" title={summary.headline}>
            {summary.headline}
          </p>
        ) : (
          job.triageReason && (
            <p
              className="mt-0.5 line-clamp-1 text-xs text-muted-foreground"
              title={job.triageReason}
            >
              {job.triageReason}
            </p>
          )
        )}
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <AgePill age={age} />
      </TableCell>
      <TableCell>
        {summary ? (
          <span className="flex items-center gap-2">
            <FitMeter
              fitLevel={summary.fitLevel}
              fitBasis={summary.fitBasis}
              labelClassName="max-sm:sr-only"
              muted={!fitColored}
            />
            <VerdictIcon verdict={summary.verdict} className="relative z-10" />
          </span>
        ) : job.origin === "discovery" ? (
          <TriageScore score={job.triageScore} muted={!fitColored} />
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
          quiet={quietStatus(tab)}
        />
      </TableCell>
    </TableRow>
  );
}

/** The listing's age or time in stage (`jobAge` / `stageAge`), tinted by what it means. */
function AgePill({
  age: { label, short, tone, tooltip, date },
  compact,
  className,
}: {
  age: Age;
  /** "~3w" instead of "Posted ~3w ago" (narrow screens). */
  compact?: boolean;
  className?: string;
}) {
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
          <time dateTime={date.toISOString()}>{compact ? short : label}</time>
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
