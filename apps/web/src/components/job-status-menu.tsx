"use client";

import { JOB_STATUS_LABELS, JOB_STATUSES, type JobLabel, type JobStatus } from "@copilot/shared";
import { cn } from "cn";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckIcon,
  ChevronDownIcon,
  StarIcon,
  StarOffIcon,
  TagIcon,
} from "lucide-react";
import { useOptimistic, useRef, useState, useTransition } from "react";
import { setJobArchivedAction, setJobStatusAction, setJobTopAction } from "@/app/actions";
import { JobLabelsEditor } from "@/components/job-labels-editor";
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
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

/**
 * Whose move it is, in one hue so it never competes with fit's colors: tinted = the user's move
 * (apply, prepare, decide), quiet with a check = waiting on the employer, plain = untouched,
 * muted = closed.
 */
const STATUS_STYLE: Record<JobStatus, string> = {
  new: "",
  shortlisted: "border-info/40 bg-info/10 text-info",
  to_apply: "border-info/60 bg-info/15 text-info",
  applied: "text-muted-foreground",
  interviewing: "border-info/40 bg-info/10 text-info",
  offer: "border-info/60 bg-info/15 font-semibold text-info",
  rejected: "text-muted-foreground",
  dismissed: "text-muted-foreground",
};

/**
 * Status button with a menu to change the status, mark it as top, edit the user's labels or
 * (un)archive the job. "Labels…" opens the labels editor anchored on the same button.
 */
export function JobStatusMenu({
  jobId,
  title,
  status,
  archived,
  top,
  labels,
  editLabels,
  quiet,
}: {
  jobId: string;
  title: string;
  status: JobStatus;
  archived: boolean;
  /** Marked as one of the user's top choices; omitted where the page has its own toggle. */
  top?: boolean;
  /** The user's labels on the job, edited via "Labels…" when `editLabels` is set. */
  labels?: readonly JobLabel[] | null;
  /** Offer "Labels…"; off where the page has its own labels editor. */
  editLabels?: boolean;
  /** Plain pill, e.g. on a tab where every job has this status. */
  quiet?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  // Optimistic, so a second toggle before the refresh lands undoes the first.
  const [optimisticTop, setOptimisticTop] = useOptimistic(top);
  const [labelsOpen, setLabelsOpen] = useState(false);
  // Set when "Labels…" closes the menu, so the menu doesn't pull focus back from the editor.
  const openingLabels = useRef(false);
  const trigger = (
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
  );
  const menu = (
    <DropdownMenu>
      {editLabels ? <PopoverAnchor asChild>{trigger}</PopoverAnchor> : trigger}
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (!openingLabels.current) return;
          openingLabels.current = false;
          event.preventDefault();
        }}
      >
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
        {optimisticTop !== undefined && (
          <DropdownMenuItem
            onSelect={() =>
              startTransition(async () => {
                setOptimisticTop(!optimisticTop);
                await setJobTopAction(jobId, !optimisticTop);
              })
            }
          >
            {optimisticTop ? <StarOffIcon /> : <StarIcon />}
            {optimisticTop ? "Remove top mark" : "Mark as top"}
          </DropdownMenuItem>
        )}
        {editLabels && (
          <DropdownMenuItem
            onSelect={() => {
              openingLabels.current = true;
              setLabelsOpen(true);
            }}
          >
            <TagIcon />
            Labels…
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={() => startTransition(() => setJobArchivedAction(jobId, !archived))}
        >
          {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
          {archived ? "Unarchive" : "Archive"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  if (!editLabels) return menu;
  // The editor (and its state) mounts only while the popover is open.
  return (
    <Popover open={labelsOpen} onOpenChange={setLabelsOpen}>
      {menu}
      <PopoverContent align="end" className="w-72 p-2">
        <JobLabelsEditor jobId={jobId} labels={labels ?? null} />
      </PopoverContent>
    </Popover>
  );
}
