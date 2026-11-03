"use client";

import { JOB_STATUS_LABELS, JOB_STATUSES, type JobStatus } from "@copilot/shared";
import { cn } from "cn";
import { ArchiveIcon, ArchiveRestoreIcon, ChevronDownIcon } from "lucide-react";
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

/** Pipeline stages get a hint of color; closed ones stay muted. */
const STATUS_STYLE: Record<JobStatus, string> = {
  new: "",
  shortlisted: "border-info/40 text-info",
  applied: "border-info/40 bg-info/10 text-info",
  interviewing: "border-warning/40 bg-warning/10 text-warning",
  offer: "border-success/40 bg-success/10 text-success",
  rejected: "text-muted-foreground",
  dismissed: "text-muted-foreground",
};

/** Status button with a menu to change the status or (un)archive the job. */
export function JobStatusMenu({
  jobId,
  title,
  status,
  archived,
}: {
  jobId: string;
  title: string;
  status: JobStatus;
  archived: boolean;
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
          className={cn("h-7 gap-1 rounded-full px-2.5 text-xs", STATUS_STYLE[status])}
        >
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
