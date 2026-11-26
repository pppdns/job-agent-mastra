"use client";

import { ErrorFallback } from "@/components/error-fallback";
import "./globals.css";

/**
 * Last-resort boundary (an error in a root layout). React render errors never reach Sentry's
 * global handlers on their own; ErrorFallback reports them.
 */
export default function GlobalError({ error }: { error: unknown }) {
  return (
    <html lang="en">
      <body>
        <ErrorFallback error={error} />
      </body>
    </html>
  );
}
