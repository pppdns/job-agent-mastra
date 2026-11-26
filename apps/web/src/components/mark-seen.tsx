"use client";

import { useEffect } from "react";
import { markJobSeenAction } from "@/app/actions";

/**
 * Marks a discovered job as seen once it is actually shown (not during server render, which
 * prefetching could trigger without the user opening the job).
 */
export function MarkSeen({ jobId }: { jobId: string }) {
  useEffect(() => {
    void markJobSeenAction(jobId);
  }, [jobId]);
  return null;
}
