"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RunStatusResponse } from "@/app/api/run-status/route";
import { SidebarMenuBadge } from "@/components/ui/sidebar";
import {
  markerFor,
  mergeSeen,
  parseSeen,
  type RunMarker,
  SEEN_STORAGE_KEY,
  type SeenState,
  seenAtOf,
} from "@/lib/run-markers";

const POLL_MS = 3000;
/** Chat dispatches this after sending, so the spinner shows without waiting for a poll. */
export const RUN_STARTED_EVENT = "copilot:run-started";

/**
 * Polls each chat's latest run and returns its sidebar marker. Opening a chat marks it seen.
 * Also refreshes the thread list when a run starts in a chat it doesn't list yet (a new chat)
 * and when a run ends (titles are generated after the run).
 */
export function useRunMarkers(threadIds: string[], openThreadId: string | null) {
  const router = useRouter();
  const [runs, setRuns] = useState<RunStatusResponse["runs"]>({});
  const [seen, setSeen] = useState<SeenState | null>(null);
  const known = useRef(new Set<string>());
  known.current = new Set(threadIds);
  const open = useRef(openThreadId);
  open.current = openThreadId;
  const refreshedFor = useRef(new Set<string>());
  const previous = useRef<RunStatusResponse["runs"]>({});
  /** Server clock minus browser clock, from the last poll; null until the first one. */
  const clockOffset = useRef<number | null>(null);

  // Leaving a chat marks it seen now, so a reply that ended since the last poll gets no dot.
  // Before the first poll there is no server time to record, so nothing is written.
  useEffect(() => {
    if (!openThreadId) return;
    return () => {
      if (clockOffset.current === null) return;
      markSeen(setSeen, openThreadId, Date.now() + clockOffset.current);
    };
  }, [openThreadId]);

  // Another tab opened a chat: take its seen times too.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === SEEN_STORAGE_KEY) setSeen((current) => mergeSeen(current, readStored()));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (document.visibilityState !== "visible") return;
      const response = await fetch("/api/run-status").catch(() => null);
      if (!response?.ok || cancelled) return;
      const body = (await response.json()) as RunStatusResponse;
      if (cancelled) return;
      clockOffset.current = body.now - Date.now();

      setSeen((current) => {
        if (current) return current;
        const initial = readStored() ?? { since: body.now, threads: {} };
        writeStored(initial);
        return initial;
      });
      if (open.current) markSeen(setSeen, open.current, body.now);

      let refresh = false;
      for (const [threadId, run] of Object.entries(body.runs)) {
        const before = previous.current[threadId];
        if (before?.status === "running" && run.status !== "running") refresh = true;
        if (
          run.status === "running" &&
          !known.current.has(threadId) &&
          !refreshedFor.current.has(threadId)
        ) {
          refreshedFor.current.add(threadId);
          refresh = true;
        }
      }
      previous.current = body.runs;
      setRuns(body.runs);
      if (refresh) {
        router.refresh();
        setTimeout(() => router.refresh(), 4000);
      }
    }

    void poll();
    const interval = setInterval(poll, POLL_MS);
    // The run row is written once the agent has started the run: look shortly after sending.
    const onStarted = () => setTimeout(poll, 700);
    const onVisible = () => document.visibilityState === "visible" && void poll();
    window.addEventListener(RUN_STARTED_EVENT, onStarted);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener(RUN_STARTED_EVENT, onStarted);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return (threadId: string): RunMarker | null =>
    seen ? markerFor(runs[threadId], seenAtOf(seen, threadId), threadId === openThreadId) : null;
}

/** Storage is best effort (disabled or full storage): the in-memory state still works. */
function readStored(): SeenState | null {
  try {
    return parseSeen(localStorage.getItem(SEEN_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeStored(state: SeenState) {
  try {
    localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

/** Records a chat as seen, merged with what other tabs stored so none of theirs is lost. */
function markSeen(
  setSeen: (update: (current: SeenState | null) => SeenState | null) => void,
  threadId: string,
  at: number,
) {
  setSeen((current) => {
    const base = mergeSeen(current, readStored()) ?? { since: at, threads: {} };
    const next = {
      ...base,
      threads: { ...base.threads, [threadId]: Math.max(base.threads[threadId] ?? 0, at) },
    };
    writeStored(next);
    return next;
  });
}

const LABELS: Record<RunMarker, string> = {
  running: "Reply running",
  done: "New reply",
  failed: "Reply failed",
};

/**
 * On desktop it sits where the hover-only "Chat actions" button appears and hides while that
 * shows; on mobile that button is always visible, so the marker sits just left of it.
 */
export function RunMarkerBadge({ marker }: { marker: RunMarker }) {
  return (
    <SidebarMenuBadge
      role="status"
      aria-label={LABELS[marker]}
      title={LABELS[marker]}
      data-marker={marker}
      className="right-7 md:right-1 md:group-focus-within/menu-item:opacity-0 md:group-hover/menu-item:opacity-0"
    >
      {marker === "running" ? (
        <LoaderCircleIcon className="size-3.5 animate-spin text-muted-foreground" />
      ) : (
        <span
          className={`size-2 rounded-full ${marker === "done" ? "bg-info" : "bg-destructive"}`}
        />
      )}
    </SidebarMenuBadge>
  );
}
