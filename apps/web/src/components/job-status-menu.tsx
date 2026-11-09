"use client";

import { JOB_STATUS_LABELS, JOB_STATUSES, type JobStatus } from "@copilot/shared";
import { cn } from "cn";
import { ArchiveIcon, ArchiveRestoreIcon, CheckIcon, ChevronDownIcon } from "lucide-react";
import { useTransition } from "react";
import { setJobArchivedAction, setJobStatusAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Whose move it is, in one hue so it never competes with fit's colors: tinted = the user's move
 * (apply, prepare, decide), quiet with a check = waiting on the employer, plain = untouched,
 * muted = closed.
 */
const STATUS_STYLE: Record<JobStatus, string> = {
  new: "",
  shortlisted: "border-info/40 bg-info/10 text-info",
  applied: "text-muted-foreground",
  interviewing: "border-info/40 bg-info/10 text-info",
  offer: "border-info/60 bg-info/15 font-semibold text-info",
  rejected: "text-muted-foreground",
  dismissed: "text-muted-foreground",
};

/** Status button with a menu to change the status or (un)archive the job. */
export function JobStatusMenu({
  jobId,
  title,
  status,
  archived,
  quiet,
}: {
  jobId: string;
  title: string;
  status: JobStatus;
  archived: boolean;
  /** Plain pill, e.g. on a tab where every job has this status. */
  quiet?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label={`Status of ${title}: ${JOB_STATUS_LABELS[status]}${archived ? ", archived" : ""}`}
          className={cn(
            "h-7 gap-1 rounded-full px-2.5 text-xs",
            archived ? "text-muted-foreground" : !quiet && STATUS_STYLE[status],
          )}
        >
          {status === "applied" && <CheckIcon className="size-3" />}
          {JOB_STATUS_LABELS[status]}
          <ChevronDownIcon className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={status}
          onValueChange={(value) => startTransition(() => setJobStatusAction(jobId, value))}
        >
          {JOB_STATUSES.map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              {JOB_STATUS_LABELS[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => startTransition(() => setJobArchivedAction(jobId, !archived))}
        >
          {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
          {archived ? "Unarchive" : "Archive"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
