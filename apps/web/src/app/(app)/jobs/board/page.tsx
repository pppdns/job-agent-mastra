import { listPipelineJobs } from "@copilot/db";
import { JOB_STATUS_LABELS, PIPELINE_STATUSES, type PipelineStatus } from "@copilot/shared";
import { cn } from "cn";
import { RadarIcon } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { type BoardColumn, PipelineBoard } from "@/components/pipeline-board";
import { PipelineCard } from "@/components/pipeline-card";
import { Button } from "@/components/ui/button";
import { ViewToggle } from "@/components/view-toggle";
import { progressAge } from "@/lib/job-age";
import { appDb } from "@/server/db";

export default function JobBoardPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader>
        <h1 className="text-sm font-semibold">Jobs</h1>
        <ViewToggle current="board" />
        <Button asChild size="sm" variant="ghost" className="ml-auto">
          <Link href="/discovery">
            <RadarIcon />
            Discovery
          </Link>
        </Button>
      </PageHeader>
      <div className="mx-auto w-full max-w-7xl flex-1 overflow-y-auto p-4">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading board…</p>}>
          <Board />
        </Suspense>
      </div>
    </div>
  );
}

const EMPTY_HINT: Record<PipelineStatus, string> = {
  shortlisted: "Shortlist jobs from the list to plan your applications.",
  to_apply: "Mark shortlisted jobs you've decided to apply to.",
  applied: "Nothing waiting on a reply.",
  interviewing: "No interviews going on.",
  offer: "No offers yet.",
};

async function Board() {
  await connection(); // libsql is synchronous: keep these reads out of prerendering
  const jobs = await listPipelineJobs(await appDb());
  if (jobs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing in progress yet. Shortlist jobs in the{" "}
        <Link href="/jobs" className="underline">
          list
        </Link>{" "}
        and they show up here.
      </p>
    );
  }
  const now = new Date();
  const lanes = PIPELINE_STATUSES.map((status) => {
    const cards = jobs
      .filter((j) => j.status === status)
      .map((job) => ({ job, age: progressAge(job, now) }));
    return { status, cards };
  });
  const columns: BoardColumn[] = lanes.map(({ status, cards }) => ({
    id: `column-${status}`,
    label: JOB_STATUS_LABELS[status],
    count: cards.length,
    attention: cards.filter((c) => c.age?.attention).length,
    stuck: cards.some((c) => c.age?.attention === "stuck"),
  }));
  return (
    <PipelineBoard columns={columns}>
      {lanes.map(({ status, cards }, i) => {
        const column = columns[i] as BoardColumn;
        return (
          <section
            key={status}
            id={column.id}
            aria-label={column.label}
            className="flex w-[85vw] max-w-xs shrink-0 snap-start flex-col gap-2 rounded-xl bg-muted/50 p-2 @5xl:w-auto @5xl:max-w-none"
          >
            <h2 className="flex items-center gap-2 px-1 text-sm font-medium">
              {column.label}
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {column.count}
              </span>
              {column.attention > 0 && (
                <span
                  className={cn(
                    "ml-auto inline-flex items-center gap-1 text-xs font-normal",
                    column.stuck ? "text-destructive" : "text-warning",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 rounded-full",
                      column.stuck ? "bg-destructive" : "bg-warning",
                    )}
                  />
                  {column.attention}
                  <span className="sr-only">need attention</span>
                </span>
              )}
            </h2>
            {cards.length === 0 ? (
              <p className="px-1 py-4 text-xs text-muted-foreground">{EMPTY_HINT[status]}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {cards.map(({ job, age }) => (
                  <PipelineCard key={job.id} job={job} age={age} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </PipelineBoard>
  );
}
