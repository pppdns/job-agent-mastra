"use client";

import type { JobOverview } from "@copilot/db";
import type { PipelineStatus } from "@copilot/shared";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { PipelineCard } from "@/components/pipeline-card";
import { reorderBoardColumnAction } from "@/lib/actions-client";
import type { ProgressAge } from "@/lib/job-age";

export type BoardCard = { job: JobOverview; age: ProgressAge | null };

const titleOf = (job: JobOverview) => job.title ?? "Untitled job";

/**
 * One Board column's cards, reorderable by their drag handle (pointer, touch or keyboard: Space,
 * arrows, Space). Only within the column: each column is its own `DndContext`. The new order
 * shows at once and is saved with `reorderBoardColumnAction`.
 */
export function BoardColumnCards({
  status,
  cards,
}: {
  status: PipelineStatus;
  cards: BoardCard[];
}) {
  const [, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const [order, setOrder] = useOptimistic(cards.map((c) => c.job.id));
  const byId = new Map(cards.map((c) => [c.job.id, c]));
  const ordered = order.flatMap((id) => byId.get(id) ?? []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const titleFor = (id: UniqueIdentifier) => {
    const job = byId.get(String(id))?.job;
    return job ? titleOf(job) : "Job";
  };
  const position = (id: UniqueIdentifier | undefined) =>
    `position ${order.indexOf(String(id)) + 1} of ${order.length}`;

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const next = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)));
    setFailed(false);
    start(async () => {
      setOrder(next);
      // On failure the optimistic order falls back to the saved one; say so instead of crashing.
      await reorderBoardColumnAction(status, next).catch(() => setFailed(true));
    });
  };

  return (
    <DndContext
      id={`board-${status}`}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "To reorder, press Space, move with the up and down arrows, then press Space to drop or Escape to cancel.",
        },
        announcements: {
          onDragStart: ({ active }) => `Picked up ${titleFor(active.id)}, ${position(active.id)}.`,
          onDragOver: ({ active, over }) =>
            over ? `${titleFor(active.id)} is over ${position(over.id)}.` : undefined,
          onDragEnd: ({ active, over }) => {
            if (!over) return undefined;
            return active.id === over.id
              ? `Dropped ${titleFor(active.id)}; it stays at ${position(over.id)}.`
              : `Moved ${titleFor(active.id)} to ${position(over.id)}.`;
          },
          onDragCancel: ({ active }) => `Cancelled. ${titleFor(active.id)} stays in place.`,
        },
      }}
    >
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-2">
          {ordered.map(({ job, age }) => (
            <SortableCard key={job.id} job={job} age={age} handle={ordered.length > 1} />
          ))}
        </ul>
      </SortableContext>
      {failed && (
        <p role="alert" className="px-1 text-xs text-destructive">
          Couldn't save the new order. Try again.
        </p>
      )}
    </DndContext>
  );
}

function SortableCard({ job, age, handle }: BoardCard & { handle: boolean }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: job.id, disabled: !handle });
  return (
    <PipelineCard
      job={job}
      age={age}
      sortable={{
        ref: setNodeRef,
        style: { transform: CSS.Translate.toString(transform), transition },
        dragging: isDragging,
        handle: handle && (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${titleOf(job)}`}
            className="flex size-6 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/60 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
          >
            <GripVerticalIcon className="size-4" aria-hidden />
          </button>
        ),
      }}
    />
  );
}
