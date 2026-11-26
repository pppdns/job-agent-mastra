"use client";

import * as Sentry from "@sentry/nextjs";
import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { isVersionSkewError } from "@/lib/app-update";

/**
 * What an error boundary shows. Version skew (an older page after a deploy) only needs a reload
 * and isn't reported; anything else goes to Sentry and offers Try again when the boundary can.
 */
export function ErrorFallback({ error, retry }: { error: unknown; retry?: () => void }) {
  const skew = isVersionSkewError(error);

  useEffect(() => {
    if (!skew) Sentry.captureException(error);
  }, [error, skew]);

  return (
    <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6">
      <TriangleAlertIcon className="size-6 text-warning" />
      <h2 className="text-lg font-medium">
        {skew ? "The app was updated" : "Something went wrong"}
      </h2>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        {skew
          ? "This page is from an older version. Reload to get the new one."
          : "This part of the page failed to load. Try again, or reload the page."}
      </p>
      <div className="flex gap-2">
        {!skew && retry && (
          <Button variant="outline" onClick={retry}>
            Try again
          </Button>
        )}
        <Button onClick={() => window.location.reload()}>
          <RefreshCwIcon />
          Reload
        </Button>
      </div>
    </div>
  );
}
