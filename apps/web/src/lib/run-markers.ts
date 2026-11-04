import type { ThreadRunStatus } from "@copilot/db";

export type RunMarker = "running" | "done" | "failed";

/** Per-browser record of when each chat was last looked at (server clock, ms). */
export type SeenState = { since: number; threads: Record<string, number> };

export const SEEN_STORAGE_KEY = "copilot:chat-seen";

/**
 * Running chats show a spinner; a reply that ended after the chat was last seen shows a dot
 * until it is opened. Stopped runs (the user pressed Stop) and the open chat show nothing.
 */
export function markerFor(
  run: ThreadRunStatus | undefined,
  seenAt: number,
  isOpen: boolean,
): RunMarker | null {
  if (!run) return null;
  if (run.status === "running") return "running";
  if (isOpen || run.status === "cancelled" || run.endedAt === null || run.endedAt <= seenAt) {
    return null;
  }
  return run.status === "completed" ? "done" : "failed";
}

/** Chats never opened in this browser count as seen when the browser first loaded the app. */
export const seenAtOf = (seen: SeenState, threadId: string) => seen.threads[threadId] ?? seen.since;

/** Stored seen state, or null when missing or unreadable. */
export function parseSeen(raw: string | null): SeenState | null {
  try {
    const parsed = JSON.parse(raw ?? "") as Partial<SeenState>;
    if (typeof parsed.since === "number" && parsed.threads && typeof parsed.threads === "object") {
      return { since: parsed.since, threads: parsed.threads };
    }
  } catch {}
  return null;
}

/**
 * Merges two copies of the seen state (this tab's and another tab's, via storage): the earliest
 * first-load time and, per chat, the latest seen time, so no tab can make a seen reply unread.
 */
export function mergeSeen(a: SeenState | null, b: SeenState | null): SeenState | null {
  if (!a || !b) return a ?? b;
  const threads = { ...a.threads };
  for (const [id, at] of Object.entries(b.threads)) threads[id] = Math.max(threads[id] ?? 0, at);
  return { since: Math.min(a.since, b.since), threads };
}
