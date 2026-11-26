"use client";

import { createContext, useContext, useState, useTransition } from "react";
import { setJobsStatusAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

// Bulk selection on /jobs: checkboxes in rows and the header, and a bar to shortlist or dismiss
// the selected jobs at once. Selection lives in the browser only and clears after an action.

type Selection = {
  selected: Set<string>;
  toggle: (id: string, on: boolean) => void;
  setMany: (ids: string[], on: boolean) => void;
  clear: () => void;
};

const SelectionContext = createContext<Selection | null>(null);

const useSelection = () => {
  const selection = useContext(SelectionContext);
  if (!selection) throw new Error("job selection used outside <JobSelection>");
  return selection;
};

export function JobSelection({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const value: Selection = {
    selected,
    toggle: (id, on) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      }),
    setMany: (ids, on) =>
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) {
          if (on) next.add(id);
          else next.delete(id);
        }
        return next;
      }),
    clear: () => setSelected(new Set()),
  };
  return <SelectionContext value={value}>{children}</SelectionContext>;
}

const checkboxClass = "relative z-10 size-4 cursor-pointer accent-primary align-middle";

export function RowCheckbox({ jobId, title }: { jobId: string; title: string }) {
  const { selected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      aria-label={`Select ${title}`}
      checked={selected.has(jobId)}
      onChange={(e) => toggle(jobId, e.target.checked)}
      className={checkboxClass}
    />
  );
}

export function SelectAllCheckbox({ jobIds }: { jobIds: string[] }) {
  const { selected, setMany } = useSelection();
  const all = jobIds.length > 0 && jobIds.every((id) => selected.has(id));
  return (
    <input
      type="checkbox"
      aria-label="Select all jobs on this page"
      checked={all}
      onChange={(e) => setMany(jobIds, e.target.checked)}
      className={checkboxClass}
    />
  );
}

/** Shows while jobs are selected: Shortlist, Dismiss (archives), Clear. */
export function BulkBar() {
  const { selected, clear } = useSelection();
  const [pending, start] = useTransition();
  if (selected.size === 0) return null;
  const apply = (status: "shortlisted" | "dismissed") =>
    start(async () => {
      await setJobsStatusAction([...selected], status);
      clear();
    });
  return (
    <div
      role="toolbar"
      aria-label="Selected jobs"
      className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2 shadow-sm"
    >
      <span className="text-sm font-medium tabular-nums">{selected.size} selected</span>
      <Button size="sm" disabled={pending} onClick={() => apply("shortlisted")}>
        Shortlist
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => apply("dismissed")}>
        Dismiss
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={clear} className="ml-auto">
        Clear
      </Button>
    </div>
  );
}
