"use client";

import { cn } from "cn";
import { type ReactNode, useEffect, useRef, useState } from "react";

export type BoardColumn = {
  id: string;
  label: string;
  count: number;
  /** Cards that need a follow-up or look stuck. */
  attention: number;
  /** Any of them stuck (red) rather than only due a follow-up (amber). */
  stuck: boolean;
};

/**
 * The board's columns: a 5-column grid once the board is 64rem wide (container query); below it a horizontal, snapping scroller
 * (the next column peeks in) with chips above that jump to a column and mark the visible one.
 * Children are the columns, in `columns` order, each with `id`.
 */
export function PipelineBoard({
  columns,
  children,
}: {
  columns: BoardColumn[];
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(columns[0]?.id);

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setVisible(entry.target.id);
      },
      { root, threshold: 0.6 },
    );
    for (const column of root.querySelectorAll(":scope > section")) observer.observe(column);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="@container flex flex-col gap-3">
      <nav
        aria-label="Board columns"
        className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] @5xl:hidden"
      >
        {columns.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-current={visible === c.id ? "true" : undefined}
            onClick={() => {
              // Scroll only the board: scrollIntoView would also shift the page sideways.
              const root = scroller.current;
              const column = document.getElementById(c.id);
              if (root && column) {
                root.scrollTo({
                  left: column.offsetLeft - root.offsetLeft - 16,
                  behavior: "smooth",
                });
              }
            }}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap transition-colors",
              visible === c.id
                ? "border-foreground/30 bg-foreground/5 font-medium"
                : "text-muted-foreground",
            )}
          >
            {c.label}
            <span className="tabular-nums">{c.count}</span>
            {c.attention > 0 && (
              <>
                <span
                  aria-hidden
                  className={cn("size-1.5 rounded-full", c.stuck ? "bg-destructive" : "bg-warning")}
                />
                <span className="sr-only">, {c.attention} need attention</span>
              </>
            )}
          </button>
        ))}
      </nav>
      <div
        ref={scroller}
        className="-mx-4 flex items-start snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 @5xl:mx-0 @5xl:grid @5xl:snap-none @5xl:grid-cols-4 @5xl:overflow-visible @5xl:px-0"
      >
        {children}
      </div>
    </div>
  );
}
