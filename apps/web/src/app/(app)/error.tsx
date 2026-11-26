"use client";

import { ErrorFallback } from "@/components/error-fallback";

/** Errors in a page keep the sidebar: see ErrorFallback. */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorFallback error={error} retry={retry} />;
}
