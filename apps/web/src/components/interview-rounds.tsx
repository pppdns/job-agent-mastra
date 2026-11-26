"use client";

import { MAX_INTERVIEW_ROUNDS } from "@copilot/shared";
import { cn } from "cn";
import { ChevronDownIcon, StepForwardIcon } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setInterviewRoundsAction } from "@/lib/actions-client";

type Rounds = { round: number; total: number | null };

/** "Round 2/5", or "Round 2" while the total is unknown. */
export const roundLabel = ({ round, total }: Rounds) =>
  total === null ? `Round ${round}` : `Round ${round}/${total}`;

/**
 * Where the interviews stand: one segment per round, done ones filled, the current / next one
 * outlined, upcoming ones grey; with an unknown total, a dashed segment stands for the rest.
 */
export function RoundTrack({
  round,
  total,
  className,
}: Rounds & {
  className?: string;
}) {
  const count = total ?? round;
  return (
    <span
      role="img"
      aria-label={total === null ? `Round ${round}, total unknown` : `Round ${round} of ${total}`}
      className={cn("flex h-1.5 gap-0.5", className)}
    >
      {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
        <span
          key={n}
          className={cn(
            "min-w-1.5 flex-1 rounded-full",
            n < round && "bg-info",
            n === round && "bg-info/25 ring-1 ring-info",
            n > round && "bg-muted-foreground/20",
          )}
        />
      ))}
      {total === null && (
        <span className="min-w-1.5 flex-1 rounded-full border border-dashed border-muted-foreground/50" />
      )}
    </span>
  );
}

/**
 * The round tracker with its editor: a menu to mark the current round done, pick the next round,
 * or set the total. A new round counts as progress; a new total doesn't.
 */
export function InterviewRounds({
  jobId,
  title,
  round: savedRound,
  total: savedTotal,
  compact,
  className,
}: {
  jobId: string;
  title: string;
  /** Null before interviews began: shown as round 1. */
  round: number | null;
  total: number | null;
  /** Only the segments and "2/5" (list rows). */
  compact?: boolean;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [rounds, setOptimistic] = useOptimistic<Rounds>({
    round: savedRound ?? 1,
    total: savedTotal,
  });
  const { round, total } = rounds;
  const save = ({ round, total }: Rounds) =>
    startTransition(async () => {
      // Same clamp as the server: the round never passes the total.
      const next = { round: total === null ? round : Math.min(round, total), total };
      setOptimistic(next);
      await setInterviewRoundsAction(jobId, next.round, next.total);
    });
  const roundChoices = Math.min(MAX_INTERVIEW_ROUNDS, total ?? Math.max(round + 2, 3));
  const atLast = total !== null ? round >= total : round >= MAX_INTERVIEW_ROUNDS;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label={`Interview rounds of ${title}: ${roundLabel(rounds)}`}
          className={cn(
            "group relative z-10 flex items-center gap-2 rounded-md text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            compact ? "w-24" : "w-full py-1",
            className,
          )}
        >
          <RoundTrack round={round} total={total} className="flex-1" />
          <span className="flex shrink-0 items-center gap-0.5 font-medium text-info tabular-nums">
            {compact ? (total === null ? `R${round}` : `${round}/${total}`) : roundLabel(rounds)}
            <ChevronDownIcon className="size-3 opacity-60 group-hover:opacity-100" />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem disabled={atLast} onSelect={() => save({ round: round + 1, total })}>
          <StepForwardIcon />
          Round {round} done
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Next round</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={String(round)}
          onValueChange={(value) => save({ round: Number(value), total })}
        >
          {Array.from({ length: roundChoices }, (_, i) => i + 1).map((n) => (
            <DropdownMenuRadioItem key={n} value={String(n)}>
              Round {n}
              {total !== null && <span className="text-muted-foreground"> of {total}</span>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            Total rounds
            <span className="ml-auto text-muted-foreground">{total ?? "Unknown"}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={total === null ? "unknown" : String(total)}
              onValueChange={(value) =>
                save({ round, total: value === "unknown" ? null : Number(value) })
              }
            >
              <DropdownMenuRadioItem value="unknown">Unknown</DropdownMenuRadioItem>
              {Array.from({ length: MAX_INTERVIEW_ROUNDS }, (_, i) => i + 1).map((n) => (
                <DropdownMenuRadioItem key={n} value={String(n)}>
                  {n}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
