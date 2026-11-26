"use client";

import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import type { VersionResponse } from "@/app/api/version/route";
import { Button } from "@/components/ui/button";
import {
  isVersionSkewError,
  markAppOutdated,
  markAppStale,
  useAppUpdateState,
} from "@/lib/app-update";

const CHECK_EVERY_MS = 5 * 60_000;

/** Asks the server which deploy it runs; marks the app stale when it isn't this page's. */
async function checkVersion() {
  const own = document.documentElement.dataset.dplId;
  if (!own || document.visibilityState !== "visible") return;
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return; // e.g. logged out
    const { deploymentId } = (await res.json()) as VersionResponse;
    if (deploymentId && deploymentId !== own) markAppStale();
  } catch {
    // Offline or mid-deploy: the next check tries again.
  }
}

/**
 * Shown when this page is from an older deploy than the server's: before anything failed
 * ("stale", from the version check on focus/return and every 5 min) or after an action or a
 * lazy chunk failed because of it ("failed", from `guardAction` or the global listeners). The
 * page stays as it is, so the user can copy unsaved text before reloading.
 */
export function AppUpdateBanner() {
  const state = useAppUpdateState();

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (isVersionSkewError(event.error)) markAppOutdated();
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isVersionSkewError(event.reason)) markAppOutdated();
    };
    const onVisible = () => void checkVersion();
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(onVisible, CHECK_EVERY_MS);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);

  if (state === "current") return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-b border-warning/40 bg-background/95 px-4 py-2 text-sm shadow-sm backdrop-blur"
    >
      <TriangleAlertIcon className="size-4 shrink-0 text-warning" />
      <span>
        {state === "failed"
          ? "A new version of the app was deployed. Your last change wasn't saved: copy anything you typed, then reload."
          : "A new version of the app is available. Save or copy what you're editing, then reload."}
      </span>
      <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
        <RefreshCwIcon />
        Reload
      </Button>
    </div>
  );
}
