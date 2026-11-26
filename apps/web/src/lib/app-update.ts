import * as Sentry from "@sentry/nextjs";
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

export const SAVE_FAILED_SKEW_MESSAGE =
  "Couldn't save: the app was just updated. Copy your text, then reload.";
export const SAVE_FAILED_MESSAGE = "Couldn't save. Try again, or copy your text and reload.";

/**
 * For editors that hold typed text: a save that threw (an action unknown after a deploy, the
 * server restarting, offline) must not reach an error boundary, which would drop the text. The
 * editor catches it, shows the returned message and stays open. Version skew also raises the
 * banner; anything else goes to Sentry unless the server reported it already.
 */
export function saveFailed(error: unknown): string {
  if (isVersionSkewError(error)) {
    markAppOutdated();
    return SAVE_FAILED_SKEW_MESSAGE;
  }
  // An error thrown in the action carries a `digest`; the server already reported it.
  const fromServer = error instanceof Error && "digest" in error;
  if (!fromServer) Sentry.captureException(error);
  return SAVE_FAILED_MESSAGE;
}
