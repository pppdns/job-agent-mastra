"use client";

import { cn } from "cn";
import { StarIcon } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { setJobTopAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// The user's own "top choice" mark: a label beside the pipeline status, set only by hand.

/** "Top" label on list rows and board cards. */
export function TopBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-4 gap-0.5 border-warning/50 bg-warning/10 px-1.5 text-[11px] text-warning",
        className,
      )}
    >
      <StarIcon className="fill-current" aria-hidden />
      Top
    </Badge>
  );
}

/** Star toggle on the job page: marks or unmarks the job as a top choice. */
export function TopToggle({ jobId, top }: { jobId: string; top: boolean }) {
  const [pending, start] = useTransition();
  const [optimisticTop, setOptimisticTop] = useOptimistic(top);
  return (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={optimisticTop}
      disabled={pending}
      title={optimisticTop ? "Remove the top mark" : "Mark as one of your top choices"}
      className={cn(
        "h-7 gap-1 rounded-full px-2.5 text-xs",
        optimisticTop && "border-warning/50 bg-warning/10 text-warning hover:text-warning",
      )}
      onClick={() =>
        start(async () => {
          setOptimisticTop(!optimisticTop);
          await setJobTopAction(jobId, !optimisticTop);
        })
      }
    >
      <StarIcon className={cn("size-3", optimisticTop && "fill-current")} />
      {optimisticTop ? "Top" : "Mark top"}
    </Button>
  );
}
