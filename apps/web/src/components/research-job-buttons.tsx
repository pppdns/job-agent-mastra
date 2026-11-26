"use client";

import type { ResearchTopic } from "@copilot/shared";
import { useState, useTransition } from "react";
import { startResearchAction } from "@/app/actions";
import { ResearchSuggestions } from "@/components/research-suggestions";

/** Job page: starts research on the picked topics in a new chat and opens it there. */
export function ResearchJobButtons({ jobId, topics }: { jobId: string; topics: ResearchTopic[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="flex flex-col gap-1.5">
      <ResearchSuggestions
        topics={topics}
        disabled={pending}
        onResearch={(picked) =>
          startTransition(async () => {
            setError((await startResearchAction(jobId, picked))?.error);
          })
        }
      />
      <p className="text-xs text-muted-foreground">
        Opens a new chat. Each run has a fixed time and cost budget; findings are cited and the
        assessment is updated.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
