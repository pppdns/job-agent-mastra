import { unstable_isUnrecognizedActionError } from "next/navigation";
import { useSyncExternalStore } from "react";

/**
 * Version skew: this page comes from an older deploy than the server now runs. Its server action
 * ids and lazy JS chunks no longer exist, so the page must be reloaded (see docs/deploy.md).
 */

/** `stale`: the server reports a newer deploy. `failed`: an action or chunk load already failed. */
export type AppUpdateState = "current" | "stale" | "failed";

/** The server no longer knows this page's action, or a lazy chunk from the old build is gone. */
export function isVersionSkewError(error: unknown): boolean {
  if (unstable_isUnrecognizedActionError(error)) return true;
  if (!(error instanceof Error)) return false;
  return (
    error.name === "ChunkLoadError" ||
    /Failed to load chunk|Loading (CSS )?chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
      error.message,
    )
  );
}

let state: AppUpdateState = "current";
const listeners = new Set<() => void>();

function setState(next: AppUpdateState) {
  // `failed` wins: it also tells the user their last change wasn't saved.
  if (state === next || state === "failed") return;
  state = next;
  for (const listener of listeners) listener();
}

export const markAppOutdated = () => setState("failed");
export const markAppStale = () => setState("stale");

/** Test hook. */
export function resetAppUpdateState() {
  state = "current";
  for (const listener of listeners) listener();
}

export function getAppUpdateState() {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppUpdateState(): AppUpdateState {
  return useSyncExternalStore(subscribe, getAppUpdateState, () => "current");
}

/**
 * Wraps a server action for client code. When the call fails because of version skew, it marks
 * the app outdated (the banner appears) and returns a promise that never settles: the caller's
 * code after `await` never runs, so an editor stays open with its text, nothing claims "saved",
 * and the error never reaches an error boundary. Other errors are rethrown unchanged.
 */
export function guardAction<Args extends unknown[], Result>(
  action: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    try {
      return await action(...args);
    } catch (error) {
      if (!isVersionSkewError(error)) throw error;
      markAppOutdated();
      return new Promise<Result>(() => {});
    }
  };
}
