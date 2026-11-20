import type { JobOverview } from "@copilot/db";
import { companyLine } from "@copilot/shared";
import { NotebookTextIcon } from "lucide-react";
import Link from "next/link";
import { ProgressPill } from "@/components/age-pill";
import { FitMeter } from "@/components/assessment-visuals";
import { InterviewRounds } from "@/components/interview-rounds";
import { JobLabels } from "@/components/job-labels";
import { JobStatusMenu } from "@/components/job-status-menu";
import { TopBadge } from "@/components/top-mark";
import type { ProgressAge } from "@/lib/job-age";

/**
 * One job on the board; the title link covers the card, controls sit above it. Fit shows only
 * while shortlisted (it decides whether to apply); later the progress age matters.
 */
export function PipelineCard({
  job,
  age,
  knownLabels,
}: {
  job: JobOverview;
  age: ProgressAge | null;
  /** Labels in use on any job, for the status menu's labels picker. */
  knownLabels: string[];
}) {
  const title = job.title ?? "Untitled job";
  const meta = [companyLine(job.company, job.facts), job.location].filter(Boolean).join(" · ");
  const { summary } = job;
  return (
    <li className="relative flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm shadow-xs transition-colors hover:border-foreground/20">
      <div className="min-w-0">
        <Link
          href={`/jobs/${job.id}`}
          className="line-clamp-2 font-medium after:absolute after:inset-0 hover:underline"
        >
          {title}
        </Link>
        {meta && <p className="truncate text-xs text-muted-foreground">{meta}</p>}
        <JobLabels labels={job.labels} className="mt-1.5" />
      </div>
      {job.status === "interviewing" && (
        <InterviewRounds
          jobId={job.id}
          title={title}
          round={job.interviewRound}
          total={job.interviewRounds}
        />
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {age && <ProgressPill age={age} />}
        {job.topAt && <TopBadge />}
        {job.hasNotes && (
          <NotebookTextIcon
            className="size-3.5 text-muted-foreground"
            role="img"
            aria-label="Has a note"
          />
        )}
        {summary && job.status === "shortlisted" && (
          <FitMeter
            fitLevel={summary.fitLevel}
            fitBasis={summary.fitBasis}
            labelClassName="sr-only"
          />
        )}
        <span className="relative z-10 ml-auto">
          <JobStatusMenu
            jobId={job.id}
            title={title}
            status={job.status}
            archived={job.archivedAt !== null}
            top={job.topAt !== null}
            labels={job.labels}
            knownLabels={knownLabels}
            quiet
          />
        </span>
      </div>
    </li>
  );
}
