"use client";

import { RESEARCH_TOPIC_LABELS, type ResearchTopic } from "@copilot/shared";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "Research next" buttons for an assessment's suggested topics. Each starts a research run
 * on one topic; "All" runs them together (one budget).
 */
export function ResearchSuggestions({
  topics,
  onResearch,
  disabled,
}: {
  topics: ResearchTopic[];
  onResearch: (topics: ResearchTopic[]) => void;
  disabled?: boolean;
}) {
  if (topics.length === 0) return null;
  return (
    <fieldset aria-label="Research next" className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="mr-1 inline-flex items-center gap-1.5 text-muted-foreground">
        <SearchIcon className="size-3.5" />
        Research next
      </span>
      {topics.map((topic) => (
        <Button
          key={topic}
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled}
          onClick={() => onResearch([topic])}
        >
          {RESEARCH_TOPIC_LABELS[topic]}
        </Button>
      ))}
      {topics.length > 1 && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={disabled}
          onClick={() => onResearch(topics)}
        >
          All {topics.length}
        </Button>
      )}
    </fieldset>
  );
}
